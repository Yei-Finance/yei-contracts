/**
 * E2E — Liquidation
 *
 * Covers:
 *   - liquidationCall() with receiveAToken=false (receive underlying collateral)
 *   - liquidationCall() with receiveAToken=true (receive aToken collateral)
 *   - health factor drops below 1 via price manipulation
 *   - liquidator receives collateral + bonus
 *   - getUserAccountData() health factor before/after
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

// Setup: user1 supplies WETH, borrows USDC, then WETH price drops
async function setupLiquidatablePosition(ctx: Awaited<ReturnType<typeof deployMarket>>) {
  const { pool, oracle, weth, usdc, user1, deployer } = ctx;

  // deployer seeds USDC liquidity
  const usdcLiquidity = 1_000_000n * 10n ** 6n; // 1M USDC
  await usdc.write.mint([deployer.account.address, usdcLiquidity]);
  await usdc.write.approve([pool.address, usdcLiquidity]);
  await pool.write.supply([usdc.address, usdcLiquidity, deployer.account.address, 0]);

  // user1 supplies 10 WETH ($2000/ETH = $20,000 total collateral)
  const wethCollateral = 10n * WAD;
  await weth.write.mint([user1.account.address, wethCollateral]);
  await weth.write.approve([pool.address, wethCollateral], { account: user1.account });
  await pool.write.supply([weth.address, wethCollateral, user1.account.address, 0], {
    account: user1.account,
  });

  // user1 borrows 16,000 USDC (80% of max borrowable ~$17,000)
  // HF = 10 * 2000 * 0.85 / 16000 = 1.0625 > 1
  const borrowAmount = 16_000n * 10n ** 6n;
  await pool.write.borrow(
    [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
    {
      account: user1.account,
    }
  );

  // Verify initial HF is > 1
  // getUserAccountData returns positional tuple: [collateral, debt, availBorrows, ltThresh, ltv, healthFactor]
  const dataBefore = await pool.read.getUserAccountData([user1.account.address]);
  assert.ok(dataBefore[5] > 10n ** 18n, 'initial HF must be > 1');

  // Drop WETH price to $1,000 → HF = 10 * 1000 * 0.85 / 16000 ≈ 0.53 < 1
  await oracle.write.setAssetPrice([weth.address, 1_000n * 10n ** 8n]);

  const dataAfter = await pool.read.getUserAccountData([user1.account.address]);
  assert.ok(dataAfter[5] < 10n ** 18n, 'HF must be < 1 after price drop');

  return { wethCollateral, borrowAmount };
}

describe('E2E: Liquidation', () => {
  // ── health factor ────────────────────────────────────────────────────────────

  describe('getUserAccountData() health factor', () => {
    it('health factor starts above 1 after healthy borrow', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer } = ctx;

      await usdc.write.mint([deployer.account.address, 100_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 100_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 100_000n * 10n ** 6n, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 5n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      await pool.write.borrow(
        [usdc.address, 5_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      const data = await pool.read.getUserAccountData([user1.account.address]);
      // HF = 5 * 2000 * 0.85 / 5000 = 1.7 > 1; tuple index 5 = healthFactor
      assert.ok(data[5] > 10n ** 18n, 'HF must be > 1');
    });

    it('health factor drops below 1 after price drop', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      await setupLiquidatablePosition(ctx);

      const dataAfter = await ctx.pool.read.getUserAccountData([ctx.user1.account.address]);
      assert.ok(dataAfter[5] < 10n ** 18n, 'HF must be < 1');
    });
  });

  // ── liquidationCall (receive underlying) ─────────────────────────────────────

  describe('liquidationCall() — receive underlying collateral', () => {
    it('liquidator receives WETH + bonus after repaying USDC debt', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, aWeth, varDebtUsdc, user1, liquidator } = ctx;
      const { borrowAmount } = await setupLiquidatablePosition(ctx);

      // Liquidator gets USDC to cover 50% of debt (close factor = 50%)
      const debtToCover = borrowAmount / 2n;
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });

      const wethBefore = await weth.read.balanceOf([liquidator.account.address]);
      const aWethBefore = await aWeth.read.balanceOf([user1.account.address]);
      const debtBefore = await varDebtUsdc.read.balanceOf([user1.account.address]);

      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, false],
        { account: liquidator.account }
      );

      const wethAfter = await weth.read.balanceOf([liquidator.account.address]);
      const aWethAfter = await aWeth.read.balanceOf([user1.account.address]);
      const debtAfter = await varDebtUsdc.read.balanceOf([user1.account.address]);

      // Liquidator received WETH
      assert.ok(wethAfter > wethBefore, 'liquidator must receive WETH');
      // Collateral decreased for user1
      assert.ok(aWethAfter < aWethBefore, 'user1 aWETH must decrease');
      // Debt decreased
      assert.ok(debtAfter < debtBefore, 'user1 debt must decrease');
    });

    it('liquidation bonus: liquidator gets 5% extra collateral', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, liquidator, oracle } = ctx;
      await setupLiquidatablePosition(ctx);

      // debtToCover = 1,000 USDC at $1 = $1,000 debt value
      // WETH price = $1,000 → collateral received = $1,000 * 1.05 / $1,000 = 1.05 WETH
      const debtToCover = 1_000n * 10n ** 6n;
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });

      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, false],
        { account: liquidator.account }
      );

      const wethReceived = await weth.read.balanceOf([liquidator.account.address]);
      // Expected: debtToCover * debtPrice / collateralPrice * liquidationBonus / PERCENTAGE_FACTOR
      // = 1000 USDC * ($1 / 10^6) * (10^8 / $1000) * (10500 / 10000) * 10^18 / 10^8
      // = 1000 * 1e8 / (1000 * 1e8) * 10500 / 10000 * 1e18 = 1.05 * 1e18 = 1050000000000000000
      // The formula in LiquidationLogic: actualCollateral = actualDebt * debtPrice * bonus / (collateralPrice * 10000)
      // Numerically: 1000e6 * 1e8 * 10500 / (1000e8 * 10000) = 1050e6 * 1e8 / (1000e8 * 10000 / 1e6)
      // = 1050e6 / (1000 * 10000 / 1e6) ... simplifies to 1.05e18
      const expected = (1050n * WAD) / 1000n; // 1.05 WETH exactly
      assert.equal(
        wethReceived,
        expected,
        `liquidator must receive exactly 1.05 WETH, got ${wethReceived}`
      );
    });
  });

  // ── liquidationCall (receive aToken) ─────────────────────────────────────────

  describe('liquidationCall() — receive aToken collateral', () => {
    it('liquidator receives aWETH instead of WETH when receiveAToken=true', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, aWeth, user1, liquidator } = ctx;
      const { borrowAmount } = await setupLiquidatablePosition(ctx);

      const debtToCover = borrowAmount / 4n;
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });

      const aWethBefore = await aWeth.read.balanceOf([liquidator.account.address]);
      const wethBefore = await weth.read.balanceOf([liquidator.account.address]);

      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, true],
        { account: liquidator.account }
      );

      const aWethAfter = await aWeth.read.balanceOf([liquidator.account.address]);
      const wethAfter = await weth.read.balanceOf([liquidator.account.address]);

      // Liquidator receives aWETH (not WETH)
      assert.ok(aWethAfter > aWethBefore, 'liquidator must receive aWETH');
      assert.equal(wethAfter, wethBefore, 'liquidator must NOT receive raw WETH');
    });
  });

  // ── post-liquidation state ────────────────────────────────────────────────────

  describe('post-liquidation account state', () => {
    it('health factor improves after liquidation (mild undercollateralization)', async () => {
      // HF improves only when HF_before > bonus * LT = 1.05 * 0.85 = 0.8925.
      // Setup: 10 WETH collateral, borrow 14,000 USDC, then drop price to $1,500.
      // HF_before = 10*1500*0.85 / 14000 = 0.911 > 0.8925 → liquidation improves HF.
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, oracle, user1, liquidator, deployer } = ctx;

      const usdcLiquidity = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, usdcLiquidity]);
      await usdc.write.approve([pool.address, usdcLiquidity]);
      await pool.write.supply([usdc.address, usdcLiquidity, deployer.account.address, 0]);

      const wethCollateral = 10n * WAD;
      await weth.write.mint([user1.account.address, wethCollateral]);
      await weth.write.approve([pool.address, wethCollateral], { account: user1.account });
      await pool.write.supply([weth.address, wethCollateral, user1.account.address, 0], {
        account: user1.account,
      });

      const borrowAmount = 14_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      // Drop to $1,500: HF = 10*1500*0.85/14000 ≈ 0.911 (< 1, > 0.8925)
      await oracle.write.setAssetPrice([weth.address, 1_500n * 10n ** 8n]);

      const dataBeforeLiquidation = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(dataBeforeLiquidation[5] < 10n ** 18n, 'must be unhealthy before');

      const debtToCover = 1_000n * 10n ** 6n; // small liquidation to keep HF improving
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });
      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, false],
        { account: liquidator.account }
      );

      const dataAfterLiquidation = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(
        dataAfterLiquidation[5] > dataBeforeLiquidation[5],
        'HF must improve after liquidation'
      );
    });

    it('total debt decreases after partial liquidation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, liquidator } = ctx;
      const { borrowAmount } = await setupLiquidatablePosition(ctx);

      const dataBefore = await pool.read.getUserAccountData([user1.account.address]); // [1]=totalDebtBase

      const debtToCover = borrowAmount / 2n;
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });
      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, false],
        { account: liquidator.account }
      );

      const dataAfter = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(dataAfter[1] < dataBefore[1], 'debt must decrease');
    });
  });
});
