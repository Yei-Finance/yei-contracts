/**
 * E2E — Liquidation Edge Cases
 *
 * Covers:
 *   - ValidationLogic line 721: validateUseAsCollateral returns false when LTV=0
 *     (supply to a reserve whose LTV was set to 0 — auto-collateral disabled)
 *   - LiquidationLogic lines 373-375: mixed variable+stable debt liquidation
 *     (else branch: userVariableDebt != 0 but < actualDebtToLiquidate → burn both)
 *   - LiquidationLogic lines 454-471: _getConfigurationData with eMode and non-zero priceSource
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE, ZERO_ADDR } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

const STABLE_RATE_MODE = 1n;

describe('E2E: Liquidation Edge Cases', () => {
  // ── ValidationLogic line 721: auto-collateral disabled for LTV=0 reserve ─

  describe('validateUseAsCollateral returns false when LTV=0 (ValidationLogic line 721)', () => {
    it('supplying to a reserve with LTV=0 does not auto-enable collateral', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, aUsdc, usdc, user1 } = ctx;

      // Set USDC LTV to 0, keep liquidationThreshold=8000 (not disabling collateral entirely)
      // configureReserveAsCollateral: liquidationThreshold != 0 path, but ltv=0
      await poolConfigurator.write.configureReserveAsCollateral([usdc.address, 0n, 8000n, 10500n]);

      // user1 supplies USDC for the first time:
      // executeSupply → validateUseAsCollateral → LTV=0 → return false (line 721)
      // → collateral flag NOT set → user1 is NOT using USDC as collateral
      const amt = 1_000n * 10n ** 6n;
      await usdc.write.mint([user1.account.address, amt]);
      await usdc.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([usdc.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      const aUsdcBalance = await aUsdc.read.balanceOf([user1.account.address]);
      assert.ok(aUsdcBalance > 0n, 'user1 should have aUSDC after supply');
      // User has zero collateral base because LTV=0 means collateral flag is not auto-set
      const data = await pool.read.getUserAccountData([user1.account.address]);
      assert.equal(
        data[0],
        0n,
        'totalCollateralBase must be 0 when LTV=0 prevents auto-collateral'
      );
    });
  });

  // ── LiquidationLogic 373-375: mixed variable+stable debt liquidation ──────

  describe('mixed variable+stable debt liquidation (LiquidationLogic lines 373-375)', () => {
    it('liquidating user with both variable and stable debt burns variable first then stable', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const {
        pool,
        poolConfigurator,
        oracle,
        weth,
        usdc,
        stableDebtUsdc,
        varDebtUsdc,
        user1,
        liquidator,
        deployer,
      } = ctx;

      // Enable stable rate on USDC
      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      // Seed USDC liquidity
      const liq = 2_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      // user1 supplies 20 WETH collateral ($40,000 at $2000/WETH)
      await weth.write.mint([user1.account.address, 20n * WAD]);
      await weth.write.approve([pool.address, 20n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 20n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // user1 borrows 5,000 USDC at variable rate
      await pool.write.borrow(
        [usdc.address, 5_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // user1 borrows 10,000 USDC at stable rate (need to supply with non-USDC collateral first)
      // user1 is using WETH as collateral (not USDC), so COLLATERAL_SAME_AS_BORROWING_CURRENCY
      // check does NOT block this stable borrow
      await pool.write.borrow(
        [usdc.address, 10_000n * 10n ** 6n, STABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );
      // Total debt: 15,000 USDC; collateral: $40,000 * 0.85 = $34,000 → healthy

      // Drop WETH to $800 → HF = 20 * 800 * 0.85 / 15,000 = 0.907 < 1 → liquidatable
      await oracle.write.setAssetPrice([weth.address, 800n * 10n ** 8n]);

      // Liquidator covers 8,000 USDC:
      //   userVariableDebt ≈ 5,000 < actualDebtToLiquidate = 8,000
      //   → else branch: lines 373-375 burn ~5,000 variable first, then ~3,000 from stable
      const debtToCover = 8_000n * 10n ** 6n;
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });

      const varDebtBefore = await varDebtUsdc.read.balanceOf([user1.account.address]);
      const stableDebtBefore = await stableDebtUsdc.read.totalSupply();

      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, false],
        { account: liquidator.account }
      );

      const varDebtAfter = await varDebtUsdc.read.balanceOf([user1.account.address]);
      const stableDebtAfter = await stableDebtUsdc.read.totalSupply();

      // Variable debt should be fully burned (was < debtToCover)
      assert.equal(varDebtAfter, 0n, 'variable debt must be fully burned');
      // Stable debt should decrease by the remainder
      assert.ok(stableDebtAfter < stableDebtBefore, 'stable debt must decrease after liquidation');
    });
  });

  // ── LiquidationLogic 454-471: eMode liquidation with priceSource ──────────

  describe('_getConfigurationData with eMode and non-zero priceSource (lines 454-471)', () => {
    it('liquidating user in eMode with custom priceSource uses eMode prices for both collateral and debt', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, oracle, weth, usdc, user1, liquidator } = ctx;

      // Create eMode category 1 with priceSource = dai.address ($1/unit)
      // liquidationBonus must satisfy: 9700 * bonus <= 10000 → bonus <= 10309
      // Use 10100 (101%): 9700 * 10100 / 10000 = 9797 ≤ 10000 ✓
      // Both WETH and USDC in eMode → collateral and debt use DAI oracle price ($1)
      await poolConfigurator.write.setEModeCategory([
        1n,
        9500n,
        9700n,
        10100n,
        ctx.dai.address,
        'DaiEmode',
      ]);
      await poolConfigurator.write.setAssetEModeCategory([weth.address, 1n]);
      await poolConfigurator.write.setAssetEModeCategory([usdc.address, 1n]);

      const { deployer } = ctx;

      // Seed exactly 2,000 USDC liquidity with deployer only (small pool → ~95% utilization)
      const liq = 2_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      // user1 sets eMode, supplies 2000 WETH collateral
      // In eMode with priceSource=DAI ($1): 2000 WETH at $1 = $2000 collateral
      await pool.write.setUserEMode([1n], { account: user1.account });
      await weth.write.mint([user1.account.address, 2_000n * WAD]);
      await weth.write.approve([pool.address, 2_000n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 2_000n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow 1900 USDC (95% eMode LTV: $2000 * 95% = $1900 capacity at DAI price)
      // Pool liquidity = 2000 USDC (deployer) + 2000 USDC (user1, but user1 supplied those)
      // We need user1's aUSDC not to count since user1 will be the borrower
      // Actually user1 supplied USDC earlier in this test, so it has aUSDC + now supplying WETH
      // Just borrow from deployer's USDC seeding
      await pool.write.borrow(
        [usdc.address, 1_900n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // At 95% utilization of the 2000+2000=4000 USDC pool, rate is moderate
      // But to make user liquidatable quickly, advance time
      // At ~95% util → ~34% annual rate → debt * 1.34 after 1 year
      // After 1 year: 1900 * 1.34 ≈ 2546 USDC debt
      // eMode: $2546 debt vs 2000*$1*0.97 = $1940 capacity → HF = 1940/2546 = 0.76 ← liquidatable
      await networkHelpers.time.increase(365 * 24 * 3600);

      // Liquidator covers 100 USDC:
      // _getConfigurationData: userEModeCategory=1, priceSource=dai.address != 0
      //   → lines 456-465: isInEModeCategory(WETH) = true → use eMode bonus (10100)
      //     + collateralPriceSource = dai.address (lines 463-465)
      //   → lines 469-471: eModePriceSource != 0 → debtPriceSource = dai.address
      const debtToCover = 100n * 10n ** 6n;
      await usdc.write.mint([liquidator.account.address, debtToCover]);
      await usdc.write.approve([pool.address, debtToCover], { account: liquidator.account });

      const wethBalBefore = await weth.read.balanceOf([liquidator.account.address]);
      const varDebtBefore = await pool.read.getUserAccountData([user1.account.address]);

      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, debtToCover, false],
        { account: liquidator.account }
      );

      const wethBalAfter = await weth.read.balanceOf([liquidator.account.address]);
      const dataAfter = await pool.read.getUserAccountData([user1.account.address]);

      // Liquidator received WETH collateral
      assert.ok(
        wethBalAfter > wethBalBefore,
        'liquidator must receive WETH after eMode liquidation'
      );

      // User still has remaining debt (partial liquidation — debtToCover = 100 USDC < ~2546 USDC debt)
      assert.ok(dataAfter[1] > 0n, 'user still has remaining debt after partial liquidation');

      // Debt decreased by at least the covered amount ($100 at DAI priceSource = $1/unit)
      assert.ok(dataAfter[1] < varDebtBefore[1], 'user total debt must decrease after liquidation');

      // The collateral received should reflect the eMode liquidation bonus (10100 = 101%)
      // debtToCover = 100 USDC at $1 (DAI priceSource) → WETH at $1 (DAI priceSource)
      // collateral = debtToCover * debtPrice * bonus / (collateralPrice * 10000)
      //            = 100e6 * 1e8 * 10100 / (1e8 * 10000) = 101e6 WETH units (in 18-decimal WETH)
      // Expressed in WAD: 101 USDC-equivalent of WETH at $1/WAD = 101 * 1e12 in 18-decimal
      // Since USDC is 6 decimals and WETH is 18 decimals:
      // wethReceived = debtToCover * 1e18 / 1e6 * 10100 / 10000 = 100e6 * 1e12 * 1.01 = 101e18
      const expectedMin = 100n * WAD; // at minimum 100 WETH (1x, no bonus)
      const expectedMax = 102n * WAD; // 101 WETH (1.01x bonus) + 1 WETH tolerance
      assert.ok(
        wethBalAfter - wethBalBefore >= expectedMin,
        'liquidator must receive at least 100 WETH equivalent'
      );
      assert.ok(
        wethBalAfter - wethBalBefore <= expectedMax,
        'liquidator must not receive more than ~101 WETH equivalent'
      );
    });
  });
});
