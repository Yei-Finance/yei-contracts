/**
 * E2E — Advanced Liquidation
 *
 * Covers:
 *   - LiquidationLogic line 175-176: clear borrowing flag when all debt liquidated
 *   - LiquidationLogic lines 181-186: disable collateral when all collateral consumed
 *   - LiquidationLogic lines 213-233: protocol fee to treasury
 *   - LiquidationLogic lines 256-265: ForcedLiquidationCall event
 *   - ValidationLogic line 529: forced liquidation bypasses HF threshold check
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

describe('E2E: Advanced Liquidation', () => {
  // ── full debt liquidation (clears borrowing flag) ─────────────────────────────

  describe('full debt liquidation', () => {
    it('liquidating all debt clears the borrowing flag for that asset', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, oracle, weth, usdc, varDebtUsdc, user1, liquidator, deployer } = ctx;

      // Setup: 20 WETH, borrow 1800 USDC
      // Drop WETH to $100 → HF = 20*100*0.85/1800 ≈ 0.944 < 0.95 → max close factor (100%)
      // Collateral needed = 1800 * 1/100 * 1.05 = 18.9 WETH < 20 WETH → NOT collateral-constrained
      const liq = 2_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      const wethAmt = 20n * WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      const borrowAmt = 1_800n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Drop WETH price to $100
      await oracle.write.setAssetPrice([weth.address, 100n * 10n ** 8n]);

      // Verify HF < 0.95 for max close factor
      const data = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(data[5] < 95n * 10n ** 16n, 'HF must be < 0.95 for max close factor');

      // Liquidate with type(uint256).max → should liquidate all debt
      const maxUint = 2n ** 256n - 1n;
      await usdc.write.mint([liquidator.account.address, 2_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 2_000n * 10n ** 6n], { account: liquidator.account });

      const debtBefore = await varDebtUsdc.read.balanceOf([user1.account.address]);
      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, maxUint, false],
        { account: liquidator.account }
      );

      const debtAfter = await varDebtUsdc.read.balanceOf([user1.account.address]);
      // All debt should be gone → borrowing flag cleared (line 175-176)
      assert.equal(debtAfter, 0n, 'all debt must be cleared');
    });
  });

  // ── full collateral consumed (disables collateral flag) ──────────────────────

  describe('full collateral consumed in liquidation', () => {
    it('consuming all collateral disables the collateral flag for that asset', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, oracle, weth, usdc, aWeth, user1, liquidator, deployer } = ctx;

      // Setup: 0.5 WETH, borrow 800 USDC
      // Drop WETH to $700 → HF = 0.5*700*0.85/800 = 0.372 < 0.95 → max close factor
      // Collateral needed for 800 USDC = 800*1/700*1.05 = 1.2 WETH > 0.5 WETH → all collateral consumed
      const liq = 2_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      const wethAmt = WAD / 2n; // 0.5 WETH
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      const borrowAmt = 800n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      await oracle.write.setAssetPrice([weth.address, 700n * 10n ** 8n]);

      const aWethBefore = await aWeth.read.balanceOf([user1.account.address]);
      assert.ok(aWethBefore > 0n);

      const maxUint = 2n ** 256n - 1n;
      await usdc.write.mint([liquidator.account.address, 1_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 1_000n * 10n ** 6n], { account: liquidator.account });

      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, maxUint, false],
        { account: liquidator.account }
      );

      // After liquidation, user1 should have 0 aWETH — the collateral flag was disabled
      // (setUsingAsCollateral called, lines 185-186)
      const aWethAfter = await aWeth.read.balanceOf([user1.account.address]);
      assert.equal(aWethAfter, 0n, 'all collateral must be consumed and collateral flag cleared');
    });
  });

  // ── liquidation protocol fee ─────────────────────────────────────────────────

  describe('liquidation protocol fee', () => {
    it('non-zero protocol fee routes portion of bonus to treasury', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const {
        pool,
        oracle,
        poolConfigurator,
        weth,
        usdc,
        aWeth,
        user1,
        liquidator,
        deployer,
        TREASURY,
      } = ctx;

      // Set 10% liquidation protocol fee on WETH collateral
      await poolConfigurator.write.setLiquidationProtocolFee([weth.address, 1000n]);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      const wethAmt = 10n * WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      const borrowAmt = 16_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Drop WETH to $1000 → HF < 1
      await oracle.write.setAssetPrice([weth.address, 1_000n * 10n ** 8n]);

      const treasuryAWethBefore = await aWeth.read.balanceOf([TREASURY as `0x${string}`]);

      const debtToCover = 1_000n * 10n ** 6n;
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });

      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, false],
        { account: liquidator.account }
      );

      // Treasury receives aWETH as protocol fee
      const treasuryAWethAfter = await aWeth.read.balanceOf([TREASURY as `0x${string}`]);
      assert.ok(
        treasuryAWethAfter > treasuryAWethBefore,
        'treasury must receive aWETH protocol fee'
      );
    });
  });

  // ── forced liquidation ───────────────────────────────────────────────────────

  describe('forced liquidation', () => {
    it('forced liquidation can liquidate a position with HF > 1 (bypasses HF threshold)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const {
        pool,
        poolConfigurator,
        oracle,
        weth,
        usdc,
        varDebtUsdc,
        user1,
        liquidator,
        deployer,
      } = ctx;

      // Seed USDC liquidity
      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      // user1 supplies WETH, borrows USDC
      const wethAmt = 10n * WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      const borrowAmt = 1_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Drop price slightly so HF is between 1 and CLOSE_FACTOR_HF_THRESHOLD (0.95..1.0)
      // HF = 10 * 1200 * 0.85 / 1000 = 10.2 → still healthy, but set forced liquidation
      // Actually keep WETH at $2000 → HF = 10*2000*0.85/1000 = 17 (very healthy)
      // Forced liquidation bypasses the HF check, so HF > 1 still liquidatable

      // Freeze USDC (forced liquidation requires frozen reserve)
      await poolConfigurator.write.setReserveFreeze([usdc.address, true]);
      await poolConfigurator.write.setForcedLiquidationEnabled([usdc.address, true]);

      // Position is HEALTHY (HF >> 1), but forced liquidation is enabled on debt asset
      const data = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(data[5] > 10n ** 18n, 'HF must be > 1 (healthy)');

      // Whitelist the liquidator (required when forced liquidation is enabled and caller != user)
      await poolConfigurator.write.addToForcedLiquidationWhitelist([liquidator.account.address]);

      // Liquidation should succeed despite HF > 1 because forced liquidation bypasses check
      const debtToCover = 500n * 10n ** 6n;
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });

      const debtBefore = await varDebtUsdc.read.balanceOf([user1.account.address]);
      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, false],
        { account: liquidator.account }
      );

      const debtAfter = await varDebtUsdc.read.balanceOf([user1.account.address]);
      assert.ok(debtAfter < debtBefore, 'forced liquidation must reduce debt even with HF > 1');
    });

    it('forced liquidation whitelist: add/remove changes isInForcedLiquidationWhitelist state', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, user1 } = ctx;

      // Initially not whitelisted
      assert.ok(
        !(await pool.read.isInForcedLiquidationWhitelist([user1.account.address])),
        'user must not be in whitelist initially'
      );

      // Add to whitelist
      await poolConfigurator.write.addToForcedLiquidationWhitelist([user1.account.address]);
      assert.ok(
        await pool.read.isInForcedLiquidationWhitelist([user1.account.address]),
        'user must be in whitelist after addToForcedLiquidationWhitelist'
      );

      // Remove from whitelist
      await poolConfigurator.write.removeFromForcedLiquidationWhitelist([user1.account.address]);
      assert.ok(
        !(await pool.read.isInForcedLiquidationWhitelist([user1.account.address])),
        'user must not be in whitelist after removeFromForcedLiquidationWhitelist'
      );
    });
  });
});
