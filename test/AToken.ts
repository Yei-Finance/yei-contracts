/**
 * AToken — rounding and token accounting coverage
 *
 * Tests AToken mint, burn, mintToTreasury, and balanceOf using a minimal
 * MockPoolMinimal that acts as the pool without the full protocol stack.
 *
 * Key invariants under test:
 *   - mint uses rayDivFloor → user gets fewer scaled tokens (protocol favored)
 *   - burn uses rayDivCeil  → user burns more scaled tokens (protocol favored)
 *   - burn scaledAmount > mint scaledAmount for same underlying amount/index
 *   - balanceOf = rayMulFloor(scaledBalance, index)
 *   - isFirstSupply flag
 *
 * No tolerance buffers — all values are exact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';

const RAY = 10n ** 27n;

// ─── addresses ────────────────────────────────────────────────────────────────

const TREASURY = '0x0000000000000000000000000000000000000001' as `0x${string}`;
const UNDERLYING = '0x0000000000000000000000000000000000000002' as `0x${string}`;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

// ─── JS reference helpers ─────────────────────────────────────────────────────

const rayDivFloor = (a: bigint, b: bigint) => (a * RAY) / b;
const rayDivCeil = (a: bigint, b: bigint) => (a * RAY + b - 1n) / b;
const rayMulFloor = (a: bigint, b: bigint) => (a * b) / RAY;

// ─── setup ────────────────────────────────────────────────────────────────────

const { viem, networkHelpers } = await network.connect();
const [deployer, user1, user2] = await viem.getWalletClients();

const USER = deployer.account.address;
const USER2 = user1.account.address;

// ─── fixture ──────────────────────────────────────────────────────────────────

async function deployATokenFixture() {
  const pool = await viem.deployContract('MockPoolMinimal');
  const aToken = await viem.deployContract('AToken', [pool.address]);

  await aToken.write.initialize([
    pool.address, // initializingPool — must equal POOL stored in constructor
    TREASURY,
    UNDERLYING,
    ZERO_ADDR, // no incentives controller
    18, // decimals
    'Test aToken',
    'aTEST',
    '0x' as `0x`,
  ]);

  return { pool, aToken };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('AToken', () => {
  // ── mint ──────────────────────────────────────────────────────────────────

  describe('mint()', () => {
    it('returns true (isFirstSupply) on first mint to a fresh address', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const result = await pool.simulate.mintAToken([aToken.address, USER, USER, RAY, RAY]);
      assert.ok(result.result, 'expected isFirstSupply = true');
    });

    it('returns false on subsequent mint to same address', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      await pool.write.mintAToken([aToken.address, USER, USER, RAY, RAY]);
      const result = await pool.simulate.mintAToken([aToken.address, USER, USER, RAY, RAY]);
      assert.ok(!result.result, 'expected isFirstSupply = false on second mint');
    });

    it('exact at index=RAY: scaledBalance == amount', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const amount = 1_000_000_000_000_000_000n; // 1 ETH
      await pool.write.mintAToken([aToken.address, USER, USER, amount, RAY]);
      assert.equal(await aToken.read.scaledBalanceOf([USER]), amount);
    });

    it('uses rayDivFloor: scaledBalance = floor(amount * RAY / index)', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const amount = 3n;
      const index = 2n * RAY + 1n; // non-exact division
      const expected = rayDivFloor(amount, index);
      await pool.write.mintAToken([aToken.address, USER, USER, amount, index]);
      assert.equal(await aToken.read.scaledBalanceOf([USER]), expected);
    });

    it('realistic amounts: 1 ETH at 1.05 index → correct floor', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const amount = 1_000_000_000_000_000_001n; // 1 ETH + 1 wei
      const index = 1_050_000_000_000_000_000_000_000_000n; // 1.05 * RAY
      const expected = rayDivFloor(amount, index);
      await pool.write.mintAToken([aToken.address, USER, USER, amount, index]);
      assert.equal(await aToken.read.scaledBalanceOf([USER]), expected);
    });

    it('accumulates scaled balance on multiple mints', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const amount = 1_000_000_000n;
      const index = RAY;
      await pool.write.mintAToken([aToken.address, USER, USER, amount, index]);
      await pool.write.mintAToken([aToken.address, USER, USER, amount, index]);
      assert.equal(await aToken.read.scaledBalanceOf([USER]), 2n * amount);
    });

    it('different callers and onBehalfOf addresses are tracked separately', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      await pool.write.mintAToken([aToken.address, USER, USER, 1000n, RAY]);
      await pool.write.mintAToken([aToken.address, USER2, USER2, 2000n, RAY]);
      assert.equal(await aToken.read.scaledBalanceOf([USER]), 1000n);
      assert.equal(await aToken.read.scaledBalanceOf([USER2]), 2000n);
    });

    it('reverts when called from non-pool address (onlyPool)', async () => {
      const { aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      await assert.rejects(aToken.write.mint([USER, USER, 1000n, RAY]));
    });
  });

  // ── burn ──────────────────────────────────────────────────────────────────

  describe('burn()', () => {
    it('exact at index=RAY: scaledBalance reduced by amount after burn', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const amount = 1_000_000n;
      await pool.write.mintAToken([aToken.address, USER, USER, amount, RAY]);
      // burn uses ceil: ceil(amount * RAY / RAY) = amount (exact)
      await pool.write.burnAToken([aToken.address, USER, aToken.address, amount, RAY]);
      assert.equal(await aToken.read.scaledBalanceOf([USER]), 0n);
    });

    it('uses rayDivCeil: burns more than mint for same amount/index', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const amount = 3n;
      const index = 2n * RAY + 1n; // non-exact division

      const mintScaled = rayDivFloor(amount, index);
      const burnScaled = rayDivCeil(amount, index);
      assert.ok(burnScaled > mintScaled, 'burn must exceed mint (protocol favored)');

      // Mint enough to then burn
      const bigAmount = 10n * RAY; // large mint at index=RAY so we have plenty
      await pool.write.mintAToken([aToken.address, USER, USER, bigAmount, RAY]);

      // Record balance before burn
      const scaledBefore = await aToken.read.scaledBalanceOf([USER]);

      // Burn `amount` at non-exact index
      await pool.write.burnAToken([aToken.address, USER, aToken.address, amount, index]);

      const scaledAfter = await aToken.read.scaledBalanceOf([USER]);
      const actualBurned = scaledBefore - scaledAfter;

      assert.equal(actualBurned, burnScaled, `burned ${actualBurned}, expected ceil ${burnScaled}`);
    });

    it('burn scaledAmount = ceil(amount * RAY / index)', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);

      // Mint a large base at RAY so user has sufficient balance
      await pool.write.mintAToken([aToken.address, USER, USER, 10n * RAY, RAY]);
      const scaledBefore = await aToken.read.scaledBalanceOf([USER]);

      const amount = 1_000_000_000_000_000_001n;
      const index = 1_050_000_000_000_000_000_000_000_000n;
      const expectedBurnScaled = rayDivCeil(amount, index);

      await pool.write.burnAToken([aToken.address, USER, aToken.address, amount, index]);

      const scaledAfter = await aToken.read.scaledBalanceOf([USER]);
      assert.equal(scaledBefore - scaledAfter, expectedBurnScaled);
    });

    it('reverts when called from non-pool address (onlyPool)', async () => {
      const { aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      await assert.rejects(aToken.write.burn([USER, aToken.address, 1000n, RAY]));
    });
  });

  // ── mintToTreasury ────────────────────────────────────────────────────────

  describe('mintToTreasury()', () => {
    it('mints to treasury using floor rounding', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const amount = 3n;
      const index = 2n * RAY + 1n;
      const expectedScaled = rayDivFloor(amount, index);

      await pool.write.mintToTreasury([aToken.address, amount, index]);
      assert.equal(await aToken.read.scaledBalanceOf([TREASURY]), expectedScaled);
    });

    it('no-ops when amount is zero (no mint emitted)', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      await pool.write.mintToTreasury([aToken.address, 0n, RAY]);
      assert.equal(await aToken.read.scaledBalanceOf([TREASURY]), 0n);
    });
  });

  // ── balanceOf ─────────────────────────────────────────────────────────────

  describe('balanceOf() — rayMulFloor(scaledBalance, index)', () => {
    it('returns rayMulFloor(scaledBalance, liquidityIndex)', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const amount = 1_000_000_000_000_000_000n;
      const mintIndex = RAY;
      await pool.write.mintAToken([aToken.address, USER, USER, amount, mintIndex]);

      // Set pool's normalized income to a new (higher) index for balanceOf query
      const queryIndex = 1_050_000_000_000_000_000_000_000_000n; // 1.05 * RAY
      await pool.write.setLiquidityIndex([queryIndex]);

      const scaledBalance = await aToken.read.scaledBalanceOf([USER]);
      const expectedBalance = rayMulFloor(scaledBalance, queryIndex);
      assert.equal(await aToken.read.balanceOf([USER]), expectedBalance);
    });

    it('returns 0 for address with no balance', async () => {
      const { aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      assert.equal(await aToken.read.balanceOf([USER2]), 0n);
    });
  });

  // ── scaledBalanceOf ────────────────────────────────────────────────────────

  describe('scaledBalanceOf()', () => {
    it('returns raw scaled balance without index multiplication', async () => {
      const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      const amount = 5_000_000_000n;
      await pool.write.mintAToken([aToken.address, USER, USER, amount, RAY]);
      assert.equal(await aToken.read.scaledBalanceOf([USER]), amount);
    });
  });

  // ── IncentivizedERC20 base functions ──────────────────────────────────────

  describe('IncentivizedERC20 base functions', () => {
    it('symbol() returns initialized symbol', async () => {
      const { aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      assert.equal(await aToken.read.symbol(), 'aTEST');
    });

    it('decimals() returns initialized decimals', async () => {
      const { aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      assert.equal(await aToken.read.decimals(), 18);
    });

    it('getIncentivesController() returns zero address when none set', async () => {
      const { aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      assert.equal(await aToken.read.getIncentivesController(), ZERO_ADDR);
    });

    it('increaseAllowance() increases spender allowance', async () => {
      const { aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      assert.equal(await aToken.read.allowance([USER, USER2]), 0n);
      await aToken.write.increaseAllowance([USER2, 500n]);
      assert.equal(await aToken.read.allowance([USER, USER2]), 500n);
    });

    it('decreaseAllowance() decreases spender allowance', async () => {
      const { aToken } = await networkHelpers.loadFixture(deployATokenFixture);
      await aToken.write.increaseAllowance([USER2, 1000n]);
      await aToken.write.decreaseAllowance([USER2, 300n]);
      assert.equal(await aToken.read.allowance([USER, USER2]), 700n);
    });
  });

  // ── rounding invariant: burn >= mint via actual contract calls ───────────

  describe('rounding invariant: burnScaled >= mintScaled (contract-verified)', () => {
    const cases: Array<[bigint, bigint, string]> = [
      [3n, 2n * RAY, 'odd amount, even-ray index'],
      [3n, 2n * RAY + 1n, 'odd amount, non-divisible index'],
      [1_000_000_000_000_000_001n, 1_050_000_000_000_000_000_000_000_000n, 'realistic 1.05 index'],
      [RAY, RAY + 1n, 'RAY amount, RAY+1 index'],
      [1n, RAY - 1n, '1 wei, RAY-1 index'],
    ];

    for (const [amount, index, label] of cases) {
      it(`${label} — mint uses floor, burn uses ceil, gap is 0 or 1`, async () => {
        const { pool, aToken } = await networkHelpers.loadFixture(deployATokenFixture);

        // Mint a buffer at the SAME index to set additionalData correctly and provide enough
        // balance for the burn (which uses ceil and thus burns more than mint).
        // Using the same index avoids the balanceIncrease underflow that occurs when
        // the stored additionalData > current index (impossible in production but triggered
        // if we used a different index for the base mint).
        const base = amount * 100n;
        await pool.write.mintAToken([aToken.address, USER, USER, base, index]);

        // Record balance after buffer mint
        const baseBefore = await aToken.read.scaledBalanceOf([USER]);

        // Mint `amount` at `index` — uses rayDivFloor
        await pool.write.mintAToken([aToken.address, USER, USER, amount, index]);
        const afterMint = await aToken.read.scaledBalanceOf([USER]);
        const mintScaled = afterMint - baseBefore;

        // JS reference
        const expectedMint = rayDivFloor(amount, index);
        assert.equal(
          mintScaled,
          expectedMint,
          `mint: got ${mintScaled}, expected floor ${expectedMint}`
        );

        // Burn `amount` at same `index` — uses rayDivCeil
        await pool.write.burnAToken([aToken.address, USER, aToken.address, amount, index]);
        const afterBurn = await aToken.read.scaledBalanceOf([USER]);
        const burnScaled = afterMint - afterBurn;

        // JS reference
        const expectedBurn = rayDivCeil(amount, index);
        assert.equal(
          burnScaled,
          expectedBurn,
          `burn: got ${burnScaled}, expected ceil ${expectedBurn}`
        );

        // Invariant: burn >= mint, gap is 0 or 1
        assert.ok(burnScaled >= mintScaled, `burn ${burnScaled} < mint ${mintScaled}`);
        const gap = burnScaled - mintScaled;
        assert.ok(gap === 0n || gap === 1n, `gap ${gap} must be 0 or 1`);
      });
    }
  });
});
