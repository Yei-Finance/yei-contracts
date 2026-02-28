/**
 * E2E — EMode Configuration and Operations
 *
 * Covers:
 *   - GenericLogic lines 77-81: calculateUserAccountData calls getEModeConfiguration (userEModeCategory != 0)
 *   - EModeLogic lines 90-97: getEModeConfiguration with non-zero priceSource
 *   - ValidationLogic lines 215-219: eMode borrow validation (asset in same eMode category)
 *   - PoolConfigurator lines 382-386: setEModeCategory validation when reserves are already assigned
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE, ZERO_ADDR } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

describe('E2E: EMode Configuration', () => {
  // ── eMode with custom price source ────────────────────────────────────────

  describe('eMode with custom price source (GenericLogic 77-81, EModeLogic 90-97)', () => {
    it('getUserAccountData for user in eMode with non-zero priceSource covers EModeLogic 93-94', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      // Create eMode category 1 with priceSource = weth.address (WETH = $2000 in oracle)
      // priceSource != address(0) → EModeLogic lines 90-91, 93-94, 97 are all hit
      await poolConfigurator.write.setEModeCategory([
        1n, // categoryId
        9500n, // ltv 95%
        9700n, // liquidationThreshold 97%
        10100n, // liquidationBonus 101%
        weth.address, // priceSource (non-zero → covers EModeLogic 93-94)
        'WethEmode',
      ]);

      // Assign WETH to eMode category 1
      await poolConfigurator.write.setAssetEModeCategory([weth.address, 1n]);

      // user1 sets eMode to category 1
      await pool.write.setUserEMode([1n], { account: user1.account });

      // user1 supplies WETH (auto-enables as collateral)
      await weth.write.mint([user1.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 5n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // getUserAccountData triggers GenericLogic.calculateUserAccountData:
      // - params.userEModeCategory = 1 != 0 → lines 77-81 are hit
      // - EModeLogic.getEModeConfiguration: eModePriceSource = weth.address != address(0)
      //   → lines 93-94 (oracle.getAssetPrice(priceSource)) and 97 (return) are hit
      const data = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(data[0] > 0n, 'user must have collateral in eMode');
    });
  });

  // ── eMode borrow validation ───────────────────────────────────────────────

  describe('eMode borrow validation (ValidationLogic 215-219)', () => {
    it('borrowing an asset in the same eMode category passes and sets eModePriceSource (line 219)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Create eMode category 1 with priceSource = usdc.address ($1 per unit)
      // This makes both WETH and USDC priced at $1 in eMode → 1000 WETH = $1000 collateral
      await poolConfigurator.write.setEModeCategory([
        1n,
        9500n,
        9700n,
        10100n,
        usdc.address,
        'UsdEmode',
      ]);

      // Assign both WETH (collateral) and USDC (borrowable) to eMode category 1
      await poolConfigurator.write.setAssetEModeCategory([weth.address, 1n]);
      await poolConfigurator.write.setAssetEModeCategory([usdc.address, 1n]);

      // Seed USDC liquidity
      const liq = 1_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      // user1 sets eMode, supplies 1000 WETH (eMode price = 1000 * $1 = $1000 collateral)
      await pool.write.setUserEMode([1n], { account: user1.account });
      await weth.write.mint([user1.account.address, 1_000n * WAD]);
      await weth.write.approve([pool.address, 1_000n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 1_000n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow 900 USDC (within 95% eMode LTV = $950 capacity):
      // Covers ValidationLogic 214-220 (if userEModeCategory != 0):
      //   - line 215-217: require(USDC.eMode == user.eMode) → passes (both in eMode 1)
      //   - line 219: vars.eModePriceSource = eModeCategories[1].priceSource
      await pool.write.borrow(
        [usdc.address, 900n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      const data = await pool.read.getUserAccountData([user1.account.address]);
      // In eMode with priceSource=USDC ($1 per unit), user borrowed 900 USDC
      // = $900 in eMode-adjusted terms. HF = 1000*$1*0.97 / $900 ≈ 1.08 > 1
      assert.ok(data[1] > 0n, 'user must have debt after borrow');
      assert.ok(data[5] > 10n ** 18n, 'health factor must be > 1 (eMode pricing used for both)');
      // The debt in base currency (USD) should reflect the eMode price, not the oracle price
      // 900 USDC at $1 each (eMode price = USDC price) → $900 base currency
      // getUserAccountData returns debt in USD with 8 decimals: $900 = 900 * 10^8
      assert.ok(
        data[1] >= 900n * 10n ** 8n - 10n ** 6n,
        'debt must be approximately $900 in base currency'
      );
    });

    it('borrowing an asset NOT in the user eMode category reverts (ValidationLogic 215-217)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, dai, user1, deployer } = ctx;

      // Create eMode category 1 (only WETH assigned)
      await poolConfigurator.write.setEModeCategory([
        1n,
        9500n,
        9700n,
        10100n,
        ZERO_ADDR as `0x${string}`,
        'EMode1',
      ]);
      await poolConfigurator.write.setAssetEModeCategory([weth.address, 1n]);
      // DAI is NOT in eMode 1

      const liq = 1_000_000n * WAD;
      await dai.write.mint([deployer.account.address, liq]);
      await dai.write.approve([pool.address, liq]);
      await pool.write.supply([dai.address, liq, deployer.account.address, 0]);

      await pool.write.setUserEMode([1n], { account: user1.account });
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow DAI (not in eMode 1) → ValidationLogic line 215-217 reverts
      await assert.rejects(
        pool.write.borrow([dai.address, 100n * WAD, VARIABLE_RATE_MODE, 0, user1.account.address], {
          account: user1.account,
        }),
        'borrowing non-eMode asset must revert with INCONSISTENT_EMODE_CATEGORY'
      );
    });
  });

  // ── setEModeCategory with existing reserves ───────────────────────────────

  describe('setEModeCategory with reserves already in eMode (PoolConfigurator 382-386)', () => {
    it('updating an eMode category iterates reserves and validates LTV/threshold (lines 382-386)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, ZERO_ADDR: _z } = ctx;

      // Step 1: Create eMode category 1 with LTV=9000, threshold=9200
      await poolConfigurator.write.setEModeCategory([
        1n,
        9000n,
        9200n,
        10200n,
        ZERO_ADDR as `0x${string}`,
        'Category1',
      ]);

      // Step 2: Assign WETH to eMode category 1
      // (WETH has individual LTV=8000, threshold=8500)
      await poolConfigurator.write.setAssetEModeCategory([weth.address, 1n]);

      // Step 3: Update eMode category 1 to higher values:
      // → loop iterates WETH (which is in eMode 1)
      // → require(newLtv > WETH.ltv) = require(9500 > 8000) → passes (line 382)
      // → require(newThreshold > WETH.threshold) = require(9700 > 8500) → passes (lines 383-386)
      await poolConfigurator.write.setEModeCategory([
        1n,
        9500n,
        9700n,
        10100n,
        ZERO_ADDR as `0x${string}`,
        'Category1Updated',
      ]);

      // Verify the category was updated: read it back from the pool
      const cat = await pool.read.getEModeCategoryData([1n]);
      assert.equal(cat.ltv, 9500, 'eMode ltv must be updated to 9500');
      assert.equal(cat.liquidationThreshold, 9700, 'eMode lt must be updated to 9700');
      assert.equal(cat.liquidationBonus, 10100, 'eMode bonus must be updated to 10100');
    });
  });
});
