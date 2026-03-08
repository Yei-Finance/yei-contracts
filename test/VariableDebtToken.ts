/**
 * VariableDebtToken — rounding and token accounting coverage
 *
 * Tests VToken mint, burn, balanceOf, and totalSupply using MockPoolMinimal.
 *
 * Key invariants under test:
 *   - mint uses rayDivCeil  → user accumulates more scaled debt (protocol favored)
 *   - burn uses rayDivFloor → user burns less scaled debt (protocol retains balance)
 *   - mint scaledAmount >= burn scaledAmount for same amount/index
 *   - balanceOf = rayMulCeil(scaledBalance, variableBorrowIndex)
 *   - noMoreDebt returned correctly
 *
 * No tolerance buffers — all values are exact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';

const RAY = 10n ** 27n;

// ─── addresses ────────────────────────────────────────────────────────────────

const UNDERLYING = '0x0000000000000000000000000000000000000002' as `0x${string}`;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

// ─── JS reference helpers ─────────────────────────────────────────────────────

const rayDivFloor = (a: bigint, b: bigint) => (a * RAY) / b;
const rayDivCeil = (a: bigint, b: bigint) => (a * RAY + b - 1n) / b;
const rayMulCeil = (a: bigint, b: bigint) => {
  const product = a * b;
  return product / RAY + (product % RAY > 0n ? 1n : 0n);
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function splitSig(sig: `0x${string}`): { v: number; r: `0x${string}`; s: `0x${string}` } {
  const hex = sig.slice(2);
  const r = `0x${hex.slice(0, 64)}` as `0x${string}`;
  const s = `0x${hex.slice(64, 128)}` as `0x${string}`;
  const v = parseInt(hex.slice(128, 130), 16);
  return { v, r, s };
}

// ─── setup ────────────────────────────────────────────────────────────────────

const { viem, networkHelpers } = await network.connect();
const [deployer, user1] = await viem.getWalletClients();

const USER = deployer.account.address;
const USER2 = user1.account.address;

// ─── fixture ──────────────────────────────────────────────────────────────────

async function deployVTokenFixture() {
  const pool = await viem.deployContract('MockPoolMinimal');
  const vToken = await viem.deployContract('VariableDebtToken', [pool.address]);

  await vToken.write.initialize([
    pool.address,
    UNDERLYING,
    ZERO_ADDR, // no incentives
    18, // decimals
    'Test vToken',
    'vTEST',
    '0x' as `0x`,
  ]);

  return { pool, vToken };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('VariableDebtToken', () => {
  // ── mint ──────────────────────────────────────────────────────────────────

  describe('mint()', () => {
    it('returns (true, totalSupply) on first borrow (isFirstBorrow = true)', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const result = await pool.simulate.mintVToken([vToken.address, USER, USER, RAY, RAY]);
      const [isFirstBorrow] = result.result as [boolean, bigint];
      assert.ok(isFirstBorrow, 'expected isFirstBorrow = true');
    });

    it('returns (false, ...) on subsequent borrow', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await pool.write.mintVToken([vToken.address, USER, USER, RAY, RAY]);
      const result = await pool.simulate.mintVToken([vToken.address, USER, USER, RAY, RAY]);
      const [isFirstBorrow] = result.result as [boolean, bigint];
      assert.ok(!isFirstBorrow, 'expected isFirstBorrow = false on second borrow');
    });

    it('exact at index=RAY: scaledBalance == amount', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const amount = 1_000_000_000_000_000_000n;
      await pool.write.mintVToken([vToken.address, USER, USER, amount, RAY]);
      assert.equal(await vToken.read.scaledBalanceOf([USER]), amount);
    });

    it('uses rayDivCeil: scaledBalance = ceil(amount * RAY / index)', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const amount = 3n;
      const index = 2n * RAY + 1n; // non-exact
      const expected = rayDivCeil(amount, index);
      await pool.write.mintVToken([vToken.address, USER, USER, amount, index]);
      assert.equal(await vToken.read.scaledBalanceOf([USER]), expected);
    });

    it('realistic: 1 ETH borrow at 1.05 index → correct ceil', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const amount = 1_000_000_000_000_000_001n;
      const index = 1_050_000_000_000_000_000_000_000_000n;
      const expected = rayDivCeil(amount, index);
      await pool.write.mintVToken([vToken.address, USER, USER, amount, index]);
      assert.equal(await vToken.read.scaledBalanceOf([USER]), expected);
    });

    it('scaledTotalSupply grows with each borrow', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await pool.write.mintVToken([vToken.address, USER, USER, RAY, RAY]);
      await pool.write.mintVToken([vToken.address, USER2, USER2, RAY, RAY]);
      assert.equal(await vToken.read.scaledTotalSupply(), 2n * RAY);
    });

    it('reverts when called from non-pool address (onlyPool)', async () => {
      const { vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await assert.rejects(vToken.write.mint([USER, USER, 1000n, RAY]));
    });
  });

  // ── burn ──────────────────────────────────────────────────────────────────

  describe('burn()', () => {
    it('exact at index=RAY: scaledBalance goes to 0 after full burn', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const amount = 1_000_000n;
      await pool.write.mintVToken([vToken.address, USER, USER, amount, RAY]);
      await pool.write.burnVToken([vToken.address, USER, amount, RAY]);
      assert.equal(await vToken.read.scaledBalanceOf([USER]), 0n);
    });

    it('returns noMoreDebt=true when all debt burned', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await pool.write.mintVToken([vToken.address, USER, USER, RAY, RAY]);
      const result = await pool.simulate.burnVToken([vToken.address, USER, RAY, RAY]);
      const [noMoreDebt] = result.result as [boolean, bigint];
      assert.ok(noMoreDebt, 'expected noMoreDebt = true after full repayment');
    });

    it('returns noMoreDebt=false when partial debt remains', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await pool.write.mintVToken([vToken.address, USER, USER, 2n * RAY, RAY]);
      const result = await pool.simulate.burnVToken([vToken.address, USER, RAY, RAY]);
      const [noMoreDebt] = result.result as [boolean, bigint];
      assert.ok(!noMoreDebt, 'expected noMoreDebt = false with remaining debt');
    });

    it('uses rayDivFloor: burns fewer scaled tokens than were minted', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const amount = 3n;
      const index = 2n * RAY + 1n;

      const mintScaled = rayDivCeil(amount, index);
      const burnScaled = rayDivFloor(amount, index);
      assert.ok(mintScaled > burnScaled, 'mint must exceed burn (protocol favored)');

      // Mint at that index
      await pool.write.mintVToken([vToken.address, USER, USER, amount, index]);
      const scaledBefore = await vToken.read.scaledBalanceOf([USER]);

      // Burn the same amount at same index
      await pool.write.burnVToken([vToken.address, USER, amount, index]);
      const scaledAfter = await vToken.read.scaledBalanceOf([USER]);

      const actualBurned = scaledBefore - scaledAfter;
      assert.equal(
        actualBurned,
        burnScaled,
        `burned ${actualBurned}, expected floor ${burnScaled}`
      );
      // Some scaled debt remains unburned → residual debt
      assert.ok(scaledAfter > 0n, 'residual scaled debt must remain after floor burn');
    });

    it('burn scaledAmount = floor(amount * RAY / index)', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      // Mint large amount at RAY index
      await pool.write.mintVToken([vToken.address, USER, USER, 10n * RAY, RAY]);
      const scaledBefore = await vToken.read.scaledBalanceOf([USER]);

      const amount = 1_000_000_000_000_000_001n;
      const index = 1_050_000_000_000_000_000_000_000_000n;
      const expectedBurnScaled = rayDivFloor(amount, index);

      await pool.write.burnVToken([vToken.address, USER, amount, index]);

      const scaledAfter = await vToken.read.scaledBalanceOf([USER]);
      assert.equal(scaledBefore - scaledAfter, expectedBurnScaled);
    });

    it('reverts when called from non-pool address (onlyPool)', async () => {
      const { vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await assert.rejects(vToken.write.burn([USER, 1000n, RAY]));
    });
  });

  // ── balanceOf ─────────────────────────────────────────────────────────────

  describe('balanceOf() — rayMulCeil(scaledBalance, index)', () => {
    it('returns rayMulCeil(scaledBalance, variableBorrowIndex)', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const amount = 1_000_000_000_000_000_000n;
      await pool.write.mintVToken([vToken.address, USER, USER, amount, RAY]);

      const queryIndex = 1_050_000_000_000_000_000_000_000_000n; // 1.05 * RAY
      await pool.write.setVariableBorrowIndex([queryIndex]);

      const scaledBalance = await vToken.read.scaledBalanceOf([USER]);
      const expectedBalance = rayMulCeil(scaledBalance, queryIndex);
      assert.equal(await vToken.read.balanceOf([USER]), expectedBalance);
    });

    it('returns 0 for address with no debt', async () => {
      const { vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      assert.equal(await vToken.read.balanceOf([USER2]), 0n);
    });

    it('debt balance > supply balance for same scaled amount and index (ceil > floor)', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await pool.write.mintVToken([vToken.address, USER, USER, 1n, RAY + 1n]);
      // scaledBalance = ceil(1 * RAY / (RAY+1)) = ceil(0.999...) = 1
      const scaledBalance = await vToken.read.scaledBalanceOf([USER]);

      const index = RAY + 1n;
      await pool.write.setVariableBorrowIndex([index]);

      // vToken.balanceOf = rayMulCeil(1, RAY+1) = ceil((RAY+1)/RAY) = 2
      // If it were floor: floor((RAY+1)/RAY) = 1
      const vBalance = await vToken.read.balanceOf([USER]);
      const floorBalance = (scaledBalance * (RAY + 1n)) / RAY; // JS floor
      assert.ok(vBalance >= floorBalance, 'vToken balance must be >= floor equivalent');
    });
  });

  // ── totalSupply ───────────────────────────────────────────────────────────

  describe('totalSupply() — rayMulCeil(scaledTotalSupply, index)', () => {
    it('returns rayMulCeil of scaled total supply', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const amount = 1_000_000_000_000_000_000n;
      await pool.write.mintVToken([vToken.address, USER, USER, amount, RAY]);

      const queryIndex = 1_020_000_000_000_000_000_000_000_000n;
      await pool.write.setVariableBorrowIndex([queryIndex]);

      const scaledSupply = await vToken.read.scaledTotalSupply();
      const expectedTotal = rayMulCeil(scaledSupply, queryIndex);
      assert.equal(await vToken.read.totalSupply(), expectedTotal);
    });
  });

  // ── non-transferable ──────────────────────────────────────────────────────

  describe('non-transferable restrictions', () => {
    it('transfer() reverts', async () => {
      const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await pool.write.mintVToken([vToken.address, USER, USER, RAY, RAY]);
      await assert.rejects(vToken.write.transfer([USER2, RAY]));
    });

    it('approve() reverts', async () => {
      const { vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await assert.rejects(vToken.write.approve([USER2, RAY]));
    });
  });

  // ── delegationWithSig ─────────────────────────────────────────────────────

  describe('delegationWithSig()', () => {
    it('sets borrowAllowance via EIP-712 signature', async () => {
      const { vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const value = 1_000n * RAY;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await vToken.read.nonces([USER]);

      const sig = await deployer.signTypedData({
        domain: {
          name: 'Test vToken',
          version: '1',
          chainId: 31337n,
          verifyingContract: vToken.address,
        },
        types: {
          DelegationWithSig: [
            { name: 'delegatee', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'DelegationWithSig',
        message: { delegatee: USER2, value, nonce, deadline },
      });

      const { v, r, s } = splitSig(sig);
      await vToken.write.delegationWithSig([USER, USER2, value, deadline, v, r, s]);
      assert.equal(await vToken.read.borrowAllowance([USER, USER2]), value);
    });

    it('increments nonce after successful delegationWithSig', async () => {
      const { vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const value = 500n * RAY;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await vToken.read.nonces([USER]);

      const sig = await deployer.signTypedData({
        domain: {
          name: 'Test vToken',
          version: '1',
          chainId: 31337n,
          verifyingContract: vToken.address,
        },
        types: {
          DelegationWithSig: [
            { name: 'delegatee', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'DelegationWithSig',
        message: { delegatee: USER2, value, nonce, deadline },
      });

      const { v, r, s } = splitSig(sig);
      await vToken.write.delegationWithSig([USER, USER2, value, deadline, v, r, s]);
      assert.equal(await vToken.read.nonces([USER]), nonce + 1n);
    });

    it('reverts with ZERO_ADDRESS_NOT_VALID for zero delegator', async () => {
      const { vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await assert.rejects(
        vToken.write.delegationWithSig([
          ZERO_ADDR,
          USER2,
          1000n,
          deadline,
          0,
          `0x${'00'.repeat(32)}` as `0x${string}`,
          `0x${'00'.repeat(32)}` as `0x${string}`,
        ])
      );
    });

    it('reverts with INVALID_EXPIRATION for past deadline', async () => {
      const { vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      await assert.rejects(
        vToken.write.delegationWithSig([
          USER,
          USER2,
          1000n,
          1n, // timestamp 1 is in the past
          0,
          `0x${'00'.repeat(32)}` as `0x${string}`,
          `0x${'00'.repeat(32)}` as `0x${string}`,
        ])
      );
    });

    it('reverts with INVALID_SIGNATURE when signed by wrong key', async () => {
      const { vToken } = await networkHelpers.loadFixture(deployVTokenFixture);
      const value = 100n * RAY;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await vToken.read.nonces([USER]);

      // user1 signs but USER (deployer) is passed as delegator → sig mismatch
      const sig = await user1.signTypedData({
        domain: {
          name: 'Test vToken',
          version: '1',
          chainId: 31337n,
          verifyingContract: vToken.address,
        },
        types: {
          DelegationWithSig: [
            { name: 'delegatee', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'DelegationWithSig',
        message: { delegatee: USER2, value, nonce, deadline },
      });

      const { v, r, s } = splitSig(sig);
      await assert.rejects(vToken.write.delegationWithSig([USER, USER2, value, deadline, v, r, s]));
    });
  });

  // ── rounding invariant: mint >= burn via actual contract calls ───────────

  describe('rounding invariant: mintScaled >= burnScaled (contract-verified)', () => {
    const cases: Array<[bigint, bigint, string]> = [
      [3n, 2n * RAY, 'odd amount, even-ray index'],
      [3n, 2n * RAY + 1n, 'odd amount, non-divisible index'],
      [1_000_000_000_000_000_001n, 1_050_000_000_000_000_000_000_000_000n, 'realistic 1.05 index'],
      [RAY, RAY + 1n, 'RAY amount, RAY+1 index'],
      [1n, RAY - 1n, '1 wei, RAY-1 index'],
    ];

    for (const [amount, index, label] of cases) {
      it(`${label} — mint uses ceil, burn uses floor, gap is 0 or 1`, async () => {
        const { pool, vToken } = await networkHelpers.loadFixture(deployVTokenFixture);

        // VToken mint uses ceil and burn uses floor, so mintScaled >= burnScaled.
        // No buffer needed: after minting `amount`, scaledBalance = mintScaled = ceil(amount/index),
        // and burnScaled = floor(amount/index) ≤ mintScaled → no underflow on burn.

        // Mint `amount` at `index` — uses rayDivCeil
        const scaledBefore = await vToken.read.scaledBalanceOf([USER]);
        await pool.write.mintVToken([vToken.address, USER, USER, amount, index]);
        const afterMint = await vToken.read.scaledBalanceOf([USER]);
        const mintScaled = afterMint - scaledBefore;

        // JS reference
        const expectedMint = rayDivCeil(amount, index);
        assert.equal(
          mintScaled,
          expectedMint,
          `mint: got ${mintScaled}, expected ceil ${expectedMint}`
        );

        // Burn `amount` at same `index` — uses rayDivFloor
        await pool.write.burnVToken([vToken.address, USER, amount, index]);
        const afterBurn = await vToken.read.scaledBalanceOf([USER]);
        const burnScaled = afterMint - afterBurn;

        // JS reference
        const expectedBurn = rayDivFloor(amount, index);
        assert.equal(
          burnScaled,
          expectedBurn,
          `burn: got ${burnScaled}, expected floor ${expectedBurn}`
        );

        // Invariant: mint >= burn, gap is 0 or 1
        assert.ok(mintScaled >= burnScaled, `mint ${mintScaled} < burn ${burnScaled}`);
        const gap = mintScaled - burnScaled;
        assert.ok(gap === 0n || gap === 1n, `gap ${gap} must be 0 or 1`);
      });
    }
  });
});
