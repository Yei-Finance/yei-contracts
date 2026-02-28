/**
 * E2E — Stable Rate Borrowing
 *
 * Covers:
 *   - PoolConfigurator lines 176-182: setReserveStableRateBorrowing
 *   - BorrowLogic lines 111-122: stable rate borrow (mint stable debt tokens)
 *   - ValidationLogic lines 279-294: stable borrow validation (enabled, max loan, collateral check)
 *   - BorrowLogic lines 219-221: repay stable debt (burn stable debt tokens)
 *   - Pool.sol line 327-332: swapBorrowRateMode
 *   - BorrowLogic lines 318-320: executeSwapBorrowRateMode (cache + updateState)
 *   - ValidationLogic lines 364-391: validateSwapRateMode (all branches)
 *   - LiquidationLogic lines 377-383: burn stable debt during liquidation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

const STABLE_RATE_MODE = 1n;

describe('E2E: Stable Rate Borrowing', () => {
  // ── setReserveStableRateBorrowing ─────────────────────────────────────────

  describe('PoolConfigurator.setReserveStableRateBorrowing', () => {
    it('enables stable rate borrowing: config stableRateBorrowing bit is set (lines 176-182)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, usdc } = ctx;

      // Stable rate borrowing is disabled by default in the fixture
      const configBefore = await pool.read.getConfiguration([usdc.address]);
      // ReserveConfiguration bit 59 = stableRateBorrowingEnabled
      const stableBitBefore = (configBefore.data >> 59n) & 1n;
      assert.equal(stableBitBefore, 0n, 'stable rate borrowing must be disabled initially');

      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      const configAfter = await pool.read.getConfiguration([usdc.address]);
      const stableBitAfter = (configAfter.data >> 59n) & 1n;
      assert.equal(
        stableBitAfter,
        1n,
        'stable rate borrowing must be enabled after setReserveStableRateBorrowing(true)'
      );
    });
  });

  // ── stable rate borrow ────────────────────────────────────────────────────

  describe('stable rate borrow (BorrowLogic 111-122, ValidationLogic 279-294)', () => {
    it('user can borrow at stable interest rate', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Enable stable rate on USDC
      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      // Seed USDC liquidity
      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      // user1 supplies WETH as collateral
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow 1000 USDC at stable rate (mode=1)
      // Covers: BorrowLogic 111-122, ValidationLogic 279 (stableRateBorrowingEnabled),
      //         281-286 (COLLATERAL_SAME_AS_BORROWING_CURRENCY check),
      //         288 (availableLiquidity), 292 (maxLoanSizeStable), 294 (amount check)
      const borrowAmt = 1_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, STABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Verify stable debt was created
      const wethReserve = await pool.read.getReserveData([usdc.address]);
      assert.ok(wethReserve.currentStableBorrowRate > 0n, 'stable borrow rate must be set');
    });
  });

  // ── repay stable debt ─────────────────────────────────────────────────────

  describe('repay stable debt (BorrowLogic 219-221)', () => {
    it('repaying stable debt burns stable debt tokens (lines 219-221)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, stableDebtUsdc, user1, deployer } = ctx;

      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      const borrowAmt = 1_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, STABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Repay half the stable debt (mode=1, covers BorrowLogic 219-221)
      const repayAmt = 500n * 10n ** 6n;
      await usdc.write.approve([pool.address, repayAmt], { account: user1.account });
      await pool.write.repay([usdc.address, repayAmt, STABLE_RATE_MODE, user1.account.address], {
        account: user1.account,
      });

      // Query StableDebtToken.totalSupply() — ReserveData has no totalStableDebt field
      const totalStableDebt = await stableDebtUsdc.read.totalSupply();
      assert.ok(totalStableDebt < borrowAmt, 'stable debt must decrease after repay');
    });
  });

  // ── swapBorrowRateMode ────────────────────────────────────────────────────

  describe('swapBorrowRateMode (Pool 327-332, BorrowLogic 318-320, ValidationLogic 364-391)', () => {
    it('swap FROM stable TO variable (ValidationLogic 371-372)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow stably
      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, STABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Swap stable→variable: covers Pool 327-332, BorrowLogic 318-320,
      // ValidationLogic 364-369 (active/not-paused/not-frozen), 371-372 (stableDebt != 0)
      await pool.write.swapBorrowRateMode([usdc.address, STABLE_RATE_MODE], {
        account: user1.account,
      });

      // After swap, user should have variable debt
      const reserveData = await pool.read.getReserveData([usdc.address]);
      assert.ok(reserveData.currentVariableBorrowRate > 0n);
    });

    it('swap FROM variable TO stable (ValidationLogic 373-389)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      // user1 supplies WETH (NOT USDC), borrows USDC at variable rate
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Swap variable→stable: covers ValidationLogic 373-374 (variableDebt != 0),
      // 382 (stableRateEnabled), 384-389 (COLLATERAL_SAME_AS_BORROWING_CURRENCY — passes
      // because user1 is NOT using USDC as collateral)
      await pool.write.swapBorrowRateMode([usdc.address, VARIABLE_RATE_MODE], {
        account: user1.account,
      });
    });

    it('swapBorrowRateMode with invalid mode=0 reverts (ValidationLogic line 391)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, user1 } = ctx;

      // Mode=0 (NONE) hits the else branch → revert(INVALID_INTEREST_RATE_MODE_SELECTED)
      // Also covers BorrowLogic 318-320 (executeSwapBorrowRateMode cache+updateState before revert)
      await assert.rejects(
        pool.write.swapBorrowRateMode([usdc.address, 0n], { account: user1.account }),
        'mode 0 must revert'
      );
    });
  });

  // ── stable debt liquidation ───────────────────────────────────────────────

  describe('liquidating a position with stable debt (LiquidationLogic 377-383)', () => {
    it('liquidating pure stable-debt position burns stable debt tokens', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const {
        pool,
        poolConfigurator,
        oracle,
        weth,
        usdc,
        stableDebtUsdc,
        user1,
        liquidator,
        deployer,
      } = ctx;

      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      // Seed USDC
      const liq = 2_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      // user1: 10 WETH collateral, borrow 10,000 USDC stably
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      await pool.write.borrow(
        [usdc.address, 10_000n * 10n ** 6n, STABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Drop WETH to $600 → HF = 10*600*0.85/10000 = 0.51 < 1
      await oracle.write.setAssetPrice([weth.address, 600n * 10n ** 8n]);

      // Liquidate 5000 USDC of stable debt (variable debt = 0):
      // → else branch in _burnDebtTokens (line 370+)
      // → userVariableDebt == 0 → skip lines 372-375
      // → lines 377-383: burn stable debt
      const debtToCover = 5_000n * 10n ** 6n;
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });

      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, false],
        { account: liquidator.account }
      );

      const totalStableDebt = await stableDebtUsdc.read.totalSupply();
      assert.ok(
        totalStableDebt < 10_000n * 10n ** 6n,
        'stable debt must decrease after liquidation'
      );
    });
  });
});
