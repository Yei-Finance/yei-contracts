/**
 * E2E — Supply & Withdraw
 *
 * Covers:
 *   - supply() basic flow with ERC20 approval
 *   - withdraw() partial and full (type(uint256).max)
 *   - setUserUseReserveAsCollateral()
 *   - AToken transfer between users
 *   - Multi-user supply isolation
 *   - Supply accounting: scaledBalance and balanceOf
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();
const MAX_UINT256 = 2n ** 256n - 1n;

describe('E2E: Supply & Withdraw', () => {
  // ── basic supply ────────────────────────────────────────────────────────────

  describe('supply()', () => {
    it('user receives aTokens proportional to supplied amount', async () => {
      const { pool, weth, aWeth, user1 } = await networkHelpers.loadFixture(deployMarket);

      const amount = 1n * WAD; // 1 WETH
      await weth.write.mint([user1.account.address, amount]);
      await weth.write.approve([pool.address, amount], { account: user1.account });
      await pool.write.supply([weth.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      // At index=RAY (initial), scaledBalance == amount
      const scaledBalance = await aWeth.read.scaledBalanceOf([user1.account.address]);
      assert.equal(scaledBalance, amount);

      const balance = await aWeth.read.balanceOf([user1.account.address]);
      // At the initial RAY index balanceOf == scaledBalance × RAY / RAY == amount exactly
      assert.equal(
        balance,
        amount,
        'aToken balance must equal supplied amount at initial RAY index'
      );
    });

    it('isFirstSupply = true on first supply: collateral auto-enabled', async () => {
      const { pool, weth, user1 } = await networkHelpers.loadFixture(deployMarket);

      const amount = 1n * WAD;
      await weth.write.mint([user1.account.address, amount * 2n]);
      await weth.write.approve([pool.address, amount * 2n], { account: user1.account });

      // Before first supply: user has no collateral
      const dataBefore = await pool.read.getUserAccountData([user1.account.address]);
      assert.equal(dataBefore[0], 0n, 'no collateral before first supply');

      // First supply (isFirstSupply = true): auto-enables collateral
      await pool.write.supply([weth.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      // Collateral should now be enabled (isFirstSupply triggered collateral activation)
      const dataAfterFirst = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(dataAfterFirst[0] > 0n, 'collateral must be enabled after first supply');

      // Second supply (isFirstSupply = false): collateral stays enabled, balance grows
      await pool.write.supply([weth.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      const dataAfterSecond = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(dataAfterSecond[0] > dataAfterFirst[0], 'collateral must grow after second supply');
    });

    it('multiple users have independent aToken balances', async () => {
      const { pool, weth, aWeth, user1, user2 } = await networkHelpers.loadFixture(deployMarket);

      const amount1 = 1n * WAD;
      const amount2 = 3n * WAD;

      await weth.write.mint([user1.account.address, amount1]);
      await weth.write.mint([user2.account.address, amount2]);
      await weth.write.approve([pool.address, amount1], { account: user1.account });
      await weth.write.approve([pool.address, amount2], { account: user2.account });

      await pool.write.supply([weth.address, amount1, user1.account.address, 0], {
        account: user1.account,
      });
      await pool.write.supply([weth.address, amount2, user2.account.address, 0], {
        account: user2.account,
      });

      assert.equal(await aWeth.read.scaledBalanceOf([user1.account.address]), amount1);
      assert.equal(await aWeth.read.scaledBalanceOf([user2.account.address]), amount2);
    });

    it('supply at index=RAY: scaledBalance == amount exactly (floor(x/RAY) = x when index=RAY)', async () => {
      const { pool, weth, aWeth, user1 } = await networkHelpers.loadFixture(deployMarket);

      // At the initial index of RAY, rayDivFloor(amount, RAY) = amount exactly (no rounding)
      const amount = 1_000_000_001n;
      await weth.write.mint([user1.account.address, amount]);
      await weth.write.approve([pool.address, amount], { account: user1.account });
      await pool.write.supply([weth.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      assert.equal(await aWeth.read.scaledBalanceOf([user1.account.address]), amount);
    });

    it('supply uses floor rounding: scaledBalance < underlying equivalent at index > RAY', async () => {
      const { pool, weth, usdc, aUsdc, user1, deployer } = await networkHelpers.loadFixture(
        deployMarket
      );

      // Seed 100k USDC; user1 supplies 60 WETH ($96k borrow capacity at 80% LTV)
      // and borrows 90k USDC (90% utilization) → USDC index grows well above RAY after 1 year
      const seed = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, seed]);
      await usdc.write.approve([pool.address, seed]);
      await pool.write.supply([usdc.address, seed, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 60n * WAD]);
      await weth.write.approve([pool.address, 60n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 60n * WAD, user1.account.address, 0], {
        account: user1.account,
      });
      await pool.write.borrow(
        [usdc.address, 90_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Advance time so USDC index grows
      const { networkHelpers: nh } = await network.connect();
      await nh.time.increase(365 * 24 * 3600);

      const RAY = 10n ** 27n;
      // Supply a tiny odd amount at the elevated index; measure the scaledTotalSupply delta
      const tinyAmount = 3n;
      await usdc.write.mint([deployer.account.address, tinyAmount]);
      await usdc.write.approve([pool.address, tinyAmount]);
      const scaledBefore = await aUsdc.read.scaledTotalSupply();
      await pool.write.supply([usdc.address, tinyAmount, deployer.account.address, 0]);
      const scaledAfter = await aUsdc.read.scaledTotalSupply();

      // The index is captured post-supply (stored in the reserve's liquidityIndex)
      const idx = (await pool.read.getReserveData([usdc.address])).liquidityIndex;

      // scaledMinted = floor(tinyAmount * RAY / idx) — protocol favors itself on supply
      const mintScaled = scaledAfter - scaledBefore;
      const expectedFloor = (tinyAmount * RAY) / idx;
      assert.equal(
        mintScaled,
        expectedFloor,
        `expected floor(${tinyAmount}*RAY/${idx}) = ${expectedFloor}`
      );
    });
  });

  // ── withdraw ────────────────────────────────────────────────────────────────

  describe('withdraw()', () => {
    it('partial withdraw reduces aToken balance correctly', async () => {
      const { pool, weth, aWeth, user1 } = await networkHelpers.loadFixture(deployMarket);

      const supply = 10n * WAD;
      const withdraw = 3n * WAD;
      await weth.write.mint([user1.account.address, supply]);
      await weth.write.approve([pool.address, supply], { account: user1.account });
      await pool.write.supply([weth.address, supply, user1.account.address, 0], {
        account: user1.account,
      });

      const balBefore = await aWeth.read.scaledBalanceOf([user1.account.address]);
      await pool.write.withdraw([weth.address, withdraw, user1.account.address], {
        account: user1.account,
      });
      const balAfter = await aWeth.read.scaledBalanceOf([user1.account.address]);

      // At index=RAY, scaledAmount = withdraw exactly (rayDivCeil(withdraw, RAY) = withdraw)
      assert.equal(balBefore - balAfter, withdraw);
      // User receives WETH back
      const wethBalance = await weth.read.balanceOf([user1.account.address]);
      assert.equal(wethBalance, withdraw);
    });

    it('full withdraw with type(uint256).max returns entire balance', async () => {
      const { pool, weth, aWeth, user1 } = await networkHelpers.loadFixture(deployMarket);

      const amount = 5n * WAD;
      await weth.write.mint([user1.account.address, amount]);
      await weth.write.approve([pool.address, amount], { account: user1.account });
      await pool.write.supply([weth.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      // type(uint256).max triggers withdraw-all
      await pool.write.withdraw([weth.address, MAX_UINT256, user1.account.address], {
        account: user1.account,
      });

      assert.equal(await aWeth.read.scaledBalanceOf([user1.account.address]), 0n);
      assert.equal(await aWeth.read.balanceOf([user1.account.address]), 0n);
    });

    it('withdraw sends underlying to a different recipient', async () => {
      const { pool, weth, user1, user2 } = await networkHelpers.loadFixture(deployMarket);

      const amount = 2n * WAD;
      await weth.write.mint([user1.account.address, amount]);
      await weth.write.approve([pool.address, amount], { account: user1.account });
      await pool.write.supply([weth.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      // Withdraw to user2
      await pool.write.withdraw([weth.address, amount, user2.account.address], {
        account: user1.account,
      });

      assert.equal(await weth.read.balanceOf([user2.account.address]), amount);
    });

    it('withdraw at index=RAY: scaledBurned == scaledMinted (no rounding at RAY)', async () => {
      const { pool, weth, aWeth, user1 } = await networkHelpers.loadFixture(deployMarket);

      // At index=RAY, rayDivCeil(amount, RAY) = amount exactly, same as mint
      const bigAmount = 10n * WAD;
      await weth.write.mint([user1.account.address, bigAmount]);
      await weth.write.approve([pool.address, bigAmount], { account: user1.account });
      await pool.write.supply([weth.address, bigAmount, user1.account.address, 0], {
        account: user1.account,
      });

      const scaledBefore = await aWeth.read.scaledBalanceOf([user1.account.address]);
      assert.equal(scaledBefore, bigAmount, 'at RAY: scaledBalance == amount after mint');

      await pool.write.withdraw([weth.address, bigAmount, user1.account.address], {
        account: user1.account,
      });
      const scaledAfter = await aWeth.read.scaledBalanceOf([user1.account.address]);

      assert.equal(scaledAfter, 0n, 'full withdraw must clear scaled balance');
      // At RAY: ceil(bigAmount * RAY / RAY) = bigAmount = scaledMinted → no protocol benefit
      assert.equal(scaledBefore - scaledAfter, bigAmount, 'burned == minted at index=RAY');
    });

    it('withdraw uses ceil rounding: scaledBurned > scaledMinted for same amount at index > RAY', async () => {
      // user1 has NO debt, giving a large aWETH buffer to safely cover the ceil-withdrawal.
      // deployer borrows WETH to create utilization → index grows above RAY after 1 year.
      const { pool, weth, usdc, aWeth, user1, deployer } = await networkHelpers.loadFixture(
        deployMarket
      );

      // user1 supplies a large WETH buffer (no debt) — this scaled balance covers the ceil withdrawal
      await weth.write.mint([user1.account.address, 20n * WAD]);
      await weth.write.approve([pool.address, 20n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 20n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // deployer provides USDC collateral and borrows WETH to push utilization → WETH interest accrues
      await usdc.write.mint([deployer.account.address, 100_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 100_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 100_000n * 10n ** 6n, deployer.account.address, 0]);
      await pool.write.borrow([
        weth.address,
        10n * WAD,
        VARIABLE_RATE_MODE,
        0,
        deployer.account.address,
      ]);

      // Advance 1 year — WETH liquidity index grows above RAY
      await networkHelpers.time.increase(365 * 24 * 3600);

      // Supply tiny 3-wei WETH from user1 (already has large balance); mine at future timestamp
      const tinyAmount = 3n;
      await weth.write.mint([user1.account.address, tinyAmount]);
      await weth.write.approve([pool.address, tinyAmount], { account: user1.account });

      const scaledBefore = await aWeth.read.scaledTotalSupply();
      await pool.write.supply([weth.address, tinyAmount, user1.account.address, 0], {
        account: user1.account,
      });
      const scaledAfterMint = await aWeth.read.scaledTotalSupply();
      const mintScaled = scaledAfterMint - scaledBefore;

      // Fetch the liquidity index as stored post-supply (this is the index used for floor)
      const idx = (await pool.read.getReserveData([weth.address])).liquidityIndex;
      const RAY_LOCAL = 10n ** 27n;
      const expectedFloor = (tinyAmount * RAY_LOCAL) / idx;
      const expectedCeil = (tinyAmount * RAY_LOCAL + idx - 1n) / idx;

      assert.equal(
        mintScaled,
        expectedFloor,
        `supply must use floor: got ${mintScaled}, expected ${expectedFloor}`
      );

      // Withdraw the same tiny amount from user1 (large pre-existing balance, no debt)
      // burnScaled = ceil(tinyAmount * RAY / idx) — user1's buffer absorbs the extra ceil unit
      await pool.write.withdraw([weth.address, tinyAmount, user1.account.address], {
        account: user1.account,
      });
      const scaledAfterBurn = await aWeth.read.scaledTotalSupply();
      const burnScaled = scaledAfterMint - scaledAfterBurn;

      assert.equal(
        burnScaled,
        expectedCeil,
        `withdraw must use ceil: got ${burnScaled}, expected ${expectedCeil}`
      );
      assert.ok(burnScaled >= mintScaled, 'ceil >= floor (protocol-favored)');
    });
  });

  // ── collateral ──────────────────────────────────────────────────────────────

  describe('setUserUseReserveAsCollateral()', () => {
    it('user can disable and re-enable collateral', async () => {
      const { pool, weth, user1 } = await networkHelpers.loadFixture(deployMarket);

      const amount = 1n * WAD;
      await weth.write.mint([user1.account.address, amount]);
      await weth.write.approve([pool.address, amount], { account: user1.account });
      await pool.write.supply([weth.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      const dataEnabled = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(dataEnabled[0] > 0n, 'totalCollateralBase must be positive after supply');

      // Disable collateral
      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });

      const dataDisabled = await pool.read.getUserAccountData([user1.account.address]);
      assert.equal(dataDisabled[0], 0n, 'totalCollateralBase must be 0 after disabling');

      // Re-enable collateral
      await pool.write.setUserUseReserveAsCollateral([weth.address, true], {
        account: user1.account,
      });

      const dataReenabled = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(dataReenabled[0] > 0n, 'totalCollateralBase must be restored after re-enabling');
      assert.equal(
        dataReenabled[0],
        dataEnabled[0],
        're-enabled collateral must equal original value'
      );
    });
  });

  // ── scaledTotalSupply and totalSupply ────────────────────────────────────────

  describe('AToken supply accounting', () => {
    it('scaledTotalSupply grows with each supplier', async () => {
      const { pool, weth, aWeth, user1, user2 } = await networkHelpers.loadFixture(deployMarket);

      const a1 = 1n * WAD;
      const a2 = 2n * WAD;
      await weth.write.mint([user1.account.address, a1]);
      await weth.write.mint([user2.account.address, a2]);
      await weth.write.approve([pool.address, a1], { account: user1.account });
      await weth.write.approve([pool.address, a2], { account: user2.account });
      await pool.write.supply([weth.address, a1, user1.account.address, 0], {
        account: user1.account,
      });
      await pool.write.supply([weth.address, a2, user2.account.address, 0], {
        account: user2.account,
      });

      assert.equal(await aWeth.read.scaledTotalSupply(), a1 + a2);
    });

    it('totalSupply returns rayMulFloor(scaledTotal, liquidityIndex)', async () => {
      const { pool, weth, aWeth, user1 } = await networkHelpers.loadFixture(deployMarket);

      const amount = 1n * WAD;
      await weth.write.mint([user1.account.address, amount]);
      await weth.write.approve([pool.address, amount], { account: user1.account });
      await pool.write.supply([weth.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      const scaledTotal = await aWeth.read.scaledTotalSupply();
      const liquidityIndex = await pool.read.getReserveNormalizedIncome([weth.address]);
      const RAY = 10n ** 27n;
      const expectedTotal = (scaledTotal * liquidityIndex) / RAY; // rayMulFloor
      const totalSupply = await aWeth.read.totalSupply();
      assert.equal(
        totalSupply,
        expectedTotal,
        'totalSupply must equal rayMulFloor(scaledTotal, index)'
      );
    });
  });

  // ── supply on behalf of ────────────────────────────────────────────────────

  describe('supply onBehalfOf', () => {
    it('deployer can supply on behalf of user1', async () => {
      const { pool, weth, aWeth, deployer, user1 } = await networkHelpers.loadFixture(deployMarket);

      const amount = 1n * WAD;
      await weth.write.mint([deployer.account.address, amount]);
      await weth.write.approve([pool.address, amount]);
      // Supply on behalf of user1 (deployer pays, user1 gets aTokens)
      await pool.write.supply([weth.address, amount, user1.account.address, 0]);

      assert.equal(await aWeth.read.scaledBalanceOf([user1.account.address]), amount);
      assert.equal(await aWeth.read.scaledBalanceOf([deployer.account.address]), 0n);
    });
  });

  // ── USDC (6 decimals) supply ────────────────────────────────────────────────

  describe('USDC (6 decimals) supply and withdraw', () => {
    it('supply and withdraw USDC with 6 decimals works correctly', async () => {
      const { pool, usdc, aUsdc, user1 } = await networkHelpers.loadFixture(deployMarket);

      const amount = 10_000n * 10n ** 6n; // 10,000 USDC
      await usdc.write.mint([user1.account.address, amount]);
      await usdc.write.approve([pool.address, amount], { account: user1.account });
      await pool.write.supply([usdc.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      assert.equal(await aUsdc.read.scaledBalanceOf([user1.account.address]), amount);

      await pool.write.withdraw([usdc.address, amount, user1.account.address], {
        account: user1.account,
      });
      assert.equal(await aUsdc.read.scaledBalanceOf([user1.account.address]), 0n);
    });
  });

  // ── getReserveData ──────────────────────────────────────────────────────────

  describe('Pool.getReserveData()', () => {
    it('returns correct aToken and variableDebtToken addresses', async () => {
      const { pool, weth, aWeth, varDebtWeth } = await networkHelpers.loadFixture(deployMarket);

      const reserveData = await pool.read.getReserveData([weth.address]);
      assert.equal(reserveData.aTokenAddress, aWeth.address);
      assert.equal(reserveData.variableDebtTokenAddress, varDebtWeth.address);
    });

    it('liquidityIndex starts at RAY (1e27)', async () => {
      const { pool, weth } = await networkHelpers.loadFixture(deployMarket);

      const reserveData = await pool.read.getReserveData([weth.address]);
      assert.equal(reserveData.liquidityIndex, 10n ** 27n);
    });
  });

  // ── Pool.getUserAccountData() ───────────────────────────────────────────────

  describe('Pool.getUserAccountData()', () => {
    it('returns correct collateral after supply', async () => {
      const { pool, weth, user1 } = await networkHelpers.loadFixture(deployMarket);

      const amount = 1n * WAD; // 1 ETH
      await weth.write.mint([user1.account.address, amount]);
      await weth.write.approve([pool.address, amount], { account: user1.account });
      await pool.write.supply([weth.address, amount, user1.account.address, 0], {
        account: user1.account,
      });

      const userData = await pool.read.getUserAccountData([user1.account.address]);
      // getUserAccountData returns a positional tuple: [totalCollateralBase, totalDebtBase, ...]
      assert.ok(userData[0] > 0n, 'collateral must be positive');
      assert.equal(userData[1], 0n, 'no debt after supply only');
    });
  });

  // ── getReservesList ─────────────────────────────────────────────────────────

  describe('Pool.getReservesList()', () => {
    it('returns the three initialized reserves', async () => {
      const { pool, weth, usdc, dai } = await networkHelpers.loadFixture(deployMarket);

      const reserves = await pool.read.getReservesList();
      assert.equal(reserves.length, 3);
      // Addresses from deployContract are lowercase; getReservesList returns checksummed — compare case-insensitively
      const reservesLc = reserves.map((a: string) => a.toLowerCase());
      assert.ok(reservesLc.includes(weth.address.toLowerCase()));
      assert.ok(reservesLc.includes(usdc.address.toLowerCase()));
      assert.ok(reservesLc.includes(dai.address.toLowerCase()));
    });
  });
});
