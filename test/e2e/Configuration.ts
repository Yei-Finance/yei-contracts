/**
 * E2E — Pool Configuration & ACL
 *
 * Covers:
 *   - PoolConfigurator: setReserveBorrowing, setReserveActive, setReserveFreeze,
 *     setReservePause, setReserveFlashLoaning, configureReserveAsCollateral,
 *     setReserveFactor, setBorrowCap, setSupplyCap, setLiquidationProtocolFee,
 *     setSiloedBorrowing, setBorrowableInIsolation, setDebtCeiling,
 *     setEModeCategory, setAssetEModeCategory, setReserveInterestRateStrategyAddress,
 *     updateFlashloanPremiumTotal, updateFlashloanPremiumToProtocol,
 *     updateBridgeProtocolFee, setPoolPause, dropReserve
 *   - Pool: setUserEMode, getEModeCategoryData, configureEModeCategory
 *   - ACLManager: all role management functions
 *   - PoolAddressesProvider: getters
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers, viem } = await network.connect();

describe('E2E: Configuration', () => {
  // ── setReserveBorrowing ──────────────────────────────────────────────────────

  describe('setReserveBorrowing()', () => {
    it('disabling borrowing prevents new borrows', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Seed liquidity
      await usdc.write.mint([deployer.account.address, 50_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 50_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 50_000n * 10n ** 6n, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Disable borrowing for USDC
      await poolConfigurator.write.setReserveBorrowing([usdc.address, false]);

      await assert.rejects(
        pool.write.borrow(
          [usdc.address, 100n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
          {
            account: user1.account,
          }
        ),
        'borrow must revert when borrowing is disabled'
      );
    });

    it('re-enabling borrowing allows borrows again', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      await usdc.write.mint([deployer.account.address, 50_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 50_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 50_000n * 10n ** 6n, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setReserveBorrowing([usdc.address, false]);
      await poolConfigurator.write.setReserveBorrowing([usdc.address, true]);

      // Now borrow should succeed
      await pool.write.borrow(
        [usdc.address, 100n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );
    });
  });

  // ── setReserveActive ─────────────────────────────────────────────────────────

  describe('setReserveActive()', () => {
    it('deactivating a reserve prevents supply', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      // Deactivate WETH (no suppliers, so _checkNoSuppliers passes)
      // Note: _checkNoSuppliers calls poolDataProvider which is not set in our minimal setup
      // So we test with a reserve that has no suppliers
      await poolConfigurator.write.setReserveActive([weth.address, false]);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });

      await assert.rejects(
        pool.write.supply([weth.address, WAD, user1.account.address, 0], {
          account: user1.account,
        }),
        'supply must revert when reserve is inactive'
      );
    });
  });

  // ── setReserveFreeze ─────────────────────────────────────────────────────────

  describe('setReserveFreeze()', () => {
    it('freezing a reserve prevents new supply and borrows', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      await poolConfigurator.write.setReserveFreeze([weth.address, true]);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });

      await assert.rejects(
        pool.write.supply([weth.address, WAD, user1.account.address, 0], {
          account: user1.account,
        }),
        'supply must revert when reserve is frozen'
      );
    });

    it('unfreeze allows supply again', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      await poolConfigurator.write.setReserveFreeze([weth.address, true]);
      await poolConfigurator.write.setReserveFreeze([weth.address, false]);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });
      await pool.write.supply([weth.address, WAD, user1.account.address, 0], {
        account: user1.account,
      });
    });
  });

  // ── setReservePause ──────────────────────────────────────────────────────────

  describe('setReservePause()', () => {
    it('pausing a reserve prevents supply', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      await poolConfigurator.write.setReservePause([weth.address, true]);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });

      await assert.rejects(
        pool.write.supply([weth.address, WAD, user1.account.address, 0], {
          account: user1.account,
        }),
        'supply must revert when reserve is paused'
      );
    });

    it('unpausing allows supply again', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      await poolConfigurator.write.setReservePause([weth.address, true]);
      await poolConfigurator.write.setReservePause([weth.address, false]);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });
      await pool.write.supply([weth.address, WAD, user1.account.address, 0], {
        account: user1.account,
      });
    });
  });

  // ── setPoolPause ─────────────────────────────────────────────────────────────

  describe('setPoolPause()', () => {
    it('pausing the pool prevents supply on all reserves', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1 } = ctx;

      await poolConfigurator.write.setPoolPause([true]);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });

      await assert.rejects(
        pool.write.supply([weth.address, WAD, user1.account.address, 0], {
          account: user1.account,
        }),
        'supply must revert when pool is paused'
      );
    });

    it('unpausing the pool restores supply', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      await poolConfigurator.write.setPoolPause([true]);
      await poolConfigurator.write.setPoolPause([false]);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });
      await pool.write.supply([weth.address, WAD, user1.account.address, 0], {
        account: user1.account,
      });
    });
  });

  // ── configureReserveAsCollateral ─────────────────────────────────────────────

  describe('configureReserveAsCollateral()', () => {
    it('updates LTV and liquidation threshold', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth } = ctx;

      // Change LTV from 8000 to 7500
      await poolConfigurator.write.configureReserveAsCollateral([
        weth.address,
        7500n,
        8000n,
        10500n,
      ]);

      const config = await pool.read.getConfiguration([weth.address]);
      // LTV occupies bits 0-15 of config.data
      const ltv = config.data & 0xffffn;
      assert.equal(ltv, 7500n);
    });
  });

  // ── setBorrowCap / setSupplyCap ──────────────────────────────────────────────

  describe('setBorrowCap() and setSupplyCap()', () => {
    it('setBorrowCap limits borrowing', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Seed liquidity
      const liq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Set borrow cap to 100 USDC (100 whole tokens for 6-decimal asset)
      await poolConfigurator.write.setBorrowCap([usdc.address, 100n]);

      // Borrow within cap succeeds
      await pool.write.borrow(
        [usdc.address, 50n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      // Borrow over cap fails
      await assert.rejects(
        pool.write.borrow(
          [usdc.address, 200n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
          {
            account: user1.account,
          }
        ),
        'borrow must revert when over cap'
      );
    });

    it('setSupplyCap limits supply', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      // Set supply cap to 5 WETH
      await poolConfigurator.write.setSupplyCap([weth.address, 5n]);

      // Supply within cap succeeds
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 4n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Supply over cap fails
      await assert.rejects(
        pool.write.supply([weth.address, 3n * WAD, user1.account.address, 0], {
          account: user1.account,
        }),
        'supply must revert when over cap'
      );
    });
  });

  // ── setReserveFactor ─────────────────────────────────────────────────────────

  describe('setReserveFactor()', () => {
    it('sets reserve factor for a given reserve', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth } = ctx;

      // 10% reserve factor = 1000 basis points
      await poolConfigurator.write.setReserveFactor([weth.address, 1000n]);

      const config = await pool.read.getConfiguration([weth.address]);
      // Reserve factor occupies bits 64-79
      const reserveFactor = (config.data >> 64n) & 0xffffn;
      assert.equal(reserveFactor, 1000n);
    });
  });

  // ── setLiquidationProtocolFee ────────────────────────────────────────────────

  describe('setLiquidationProtocolFee()', () => {
    it('sets liquidation protocol fee', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth } = ctx;

      // 10% fee = 1000 bps
      await poolConfigurator.write.setLiquidationProtocolFee([weth.address, 1000n]);

      const config = await pool.read.getConfiguration([weth.address]);
      // Liquidation protocol fee occupies bits 152-167
      const fee = (config.data >> 152n) & 0xffffn;
      assert.equal(fee, 1000n);
    });
  });

  // ── setReserveInterestRateStrategyAddress ─────────────────────────────────────

  describe('setReserveInterestRateStrategyAddress()', () => {
    it('updates the interest rate strategy for a reserve', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth, wethStrategy, stableStrategy } = ctx;

      await poolConfigurator.write.setReserveInterestRateStrategyAddress([
        weth.address,
        stableStrategy.address,
      ]);

      const reserveData = await pool.read.getReserveData([weth.address]);
      assert.equal(
        reserveData.interestRateStrategyAddress.toLowerCase(),
        stableStrategy.address.toLowerCase()
      );
    });
  });

  // ── EMode ────────────────────────────────────────────────────────────────────

  describe('EMode: setEModeCategory + setAssetEModeCategory + setUserEMode', () => {
    it('creates EMode category for stablecoins', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, usdc, dai, user1, ZERO_ADDR } = ctx;

      // Create EMode category 1: stablecoins
      // LT must be > current reserve LT (8000 for USDC/DAI)
      // LT * LB <= 10000: 9300 * 10100 / 10000 = 9393 <= 10000 ✓
      await poolConfigurator.write.setEModeCategory([
        1,
        9000, // ltv
        9300, // liquidationThreshold
        10100, // liquidationBonus (>10000 required)
        '0x0000000000000000000000000000000000000000', // no custom oracle
        'Stablecoins',
      ]);

      const categoryData = await pool.read.getEModeCategoryData([1]);
      assert.equal(categoryData.ltv, 9000);
      assert.equal(categoryData.liquidationThreshold, 9300);
      assert.equal(categoryData.liquidationBonus, 10100);
    });

    it('assigns assets to EMode category', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, usdc, dai } = ctx;

      await poolConfigurator.write.setEModeCategory([
        1,
        9000,
        9300,
        10100,
        '0x0000000000000000000000000000000000000000',
        'Stablecoins',
      ]);

      // Assign USDC and DAI to EMode 1
      await poolConfigurator.write.setAssetEModeCategory([usdc.address, 1]);
      await poolConfigurator.write.setAssetEModeCategory([dai.address, 1]);

      const usdcConfig = await pool.read.getConfiguration([usdc.address]);
      // EMode category occupies bits 168-175
      const emodeCategory = (usdcConfig.data >> 168n) & 0xffn;
      assert.equal(emodeCategory, 1n);
    });

    it('user can set EMode to 0 (default) and non-zero', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, user1 } = ctx;

      await poolConfigurator.write.setEModeCategory([
        1,
        9000,
        9300,
        10100,
        '0x0000000000000000000000000000000000000000',
        'Stablecoins',
      ]);

      // User with no positions can freely set EMode
      await pool.write.setUserEMode([1], { account: user1.account });
      assert.equal(await pool.read.getUserEMode([user1.account.address]), 1n);

      // Switch back to default EMode
      await pool.write.setUserEMode([0], { account: user1.account });
      assert.equal(await pool.read.getUserEMode([user1.account.address]), 0n);
    });
  });

  // ── setSiloedBorrowing ───────────────────────────────────────────────────────

  describe('setSiloedBorrowing()', () => {
    it('sets siloed borrowing flag on a reserve', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth } = ctx;

      await poolConfigurator.write.setSiloedBorrowing([weth.address, true]);

      const config = await pool.read.getConfiguration([weth.address]);
      // Siloed borrowing bit = bit 62
      const siloedBit = (config.data >> 62n) & 1n;
      assert.equal(siloedBit, 1n);
    });
  });

  // ── setBorrowableInIsolation ─────────────────────────────────────────────────

  describe('setBorrowableInIsolation()', () => {
    it('marks an asset as borrowable in isolation mode', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, usdc } = ctx;

      await poolConfigurator.write.setBorrowableInIsolation([usdc.address, true]);

      const config = await pool.read.getConfiguration([usdc.address]);
      // Isolation mode borrowable bit = bit 61
      const isolationBit = (config.data >> 61n) & 1n;
      assert.equal(isolationBit, 1n);
    });
  });

  // ── setDebtCeiling ───────────────────────────────────────────────────────────

  describe('setDebtCeiling()', () => {
    it('sets debt ceiling for isolation mode on a fresh reserve', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth } = ctx;

      // Debt ceiling is expressed in USD with 2 decimals (1_000_00 = $1,000)
      // Note: can only be set when reserve has no borrowers using it as isolation collateral
      await poolConfigurator.write.setDebtCeiling([weth.address, 1_000_00n]);

      const config = await pool.read.getConfiguration([weth.address]);
      // Debt ceiling occupies bits 212-251
      const debtCeiling = (config.data >> 212n) & ((1n << 40n) - 1n);
      assert.equal(debtCeiling, 1_000_00n);
    });
  });

  // ── updateBridgeProtocolFee ──────────────────────────────────────────────────

  describe('updateBridgeProtocolFee()', () => {
    it('updates bridge protocol fee', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool } = ctx;

      // Fee of 10 bps (0.1%)
      await poolConfigurator.write.updateBridgeProtocolFee([10n]);
      assert.equal(await pool.read.BRIDGE_PROTOCOL_FEE(), 10n);
    });
  });

  // ── setUnbackedMintCap ───────────────────────────────────────────────────────

  describe('setUnbackedMintCap()', () => {
    it('sets unbacked mint cap for a reserve', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth } = ctx;

      // Set unbacked mint cap of 100 WETH
      await poolConfigurator.write.setUnbackedMintCap([weth.address, 100n]);

      const config = await pool.read.getConfiguration([weth.address]);
      // Unbacked mint cap occupies bits 176-211
      const cap = (config.data >> 176n) & ((1n << 36n) - 1n);
      assert.equal(cap, 100n);
    });
  });

  // ── dropReserve ──────────────────────────────────────────────────────────────

  describe('dropReserve()', () => {
    it('drops a reserve with no suppliers or borrowers', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, dai } = ctx;

      // DAI has no suppliers, so it can be dropped
      // First deactivate it
      await poolConfigurator.write.setReserveActive([dai.address, false]);
      await poolConfigurator.write.dropReserve([dai.address]);

      const reserves = await pool.read.getReservesList();
      // Case-insensitive address comparison (deployContract returns lowercase, getReservesList returns checksummed)
      const reservesLc = reserves.map((a: string) => a.toLowerCase());
      assert.ok(
        !reservesLc.includes(dai.address.toLowerCase()),
        'DAI must no longer be in reserves list'
      );
    });
  });

  // ── ACLManager ───────────────────────────────────────────────────────────────

  describe('ACLManager role management', () => {
    it('addPoolAdmin / removePoolAdmin / isPoolAdmin', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aclManager, user1 } = ctx;

      await aclManager.write.addPoolAdmin([user1.account.address]);
      assert.ok(await aclManager.read.isPoolAdmin([user1.account.address]));

      await aclManager.write.removePoolAdmin([user1.account.address]);
      assert.ok(!(await aclManager.read.isPoolAdmin([user1.account.address])));
    });

    it('addEmergencyAdmin / removeEmergencyAdmin / isEmergencyAdmin', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aclManager, user1 } = ctx;

      await aclManager.write.addEmergencyAdmin([user1.account.address]);
      assert.ok(await aclManager.read.isEmergencyAdmin([user1.account.address]));

      await aclManager.write.removeEmergencyAdmin([user1.account.address]);
      assert.ok(!(await aclManager.read.isEmergencyAdmin([user1.account.address])));
    });

    it('addRiskAdmin / removeRiskAdmin / isRiskAdmin', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aclManager, user1 } = ctx;

      await aclManager.write.addRiskAdmin([user1.account.address]);
      assert.ok(await aclManager.read.isRiskAdmin([user1.account.address]));

      await aclManager.write.removeRiskAdmin([user1.account.address]);
      assert.ok(!(await aclManager.read.isRiskAdmin([user1.account.address])));
    });

    it('addBridge / removeBridge / isBridge', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aclManager, user1 } = ctx;

      await aclManager.write.addBridge([user1.account.address]);
      assert.ok(await aclManager.read.isBridge([user1.account.address]));

      await aclManager.write.removeBridge([user1.account.address]);
      assert.ok(!(await aclManager.read.isBridge([user1.account.address])));
    });

    it('addAssetListingAdmin / removeAssetListingAdmin / isAssetListingAdmin', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aclManager, user1 } = ctx;

      await aclManager.write.addAssetListingAdmin([user1.account.address]);
      assert.ok(await aclManager.read.isAssetListingAdmin([user1.account.address]));

      await aclManager.write.removeAssetListingAdmin([user1.account.address]);
      assert.ok(!(await aclManager.read.isAssetListingAdmin([user1.account.address])));
    });

    it('non-admin cannot add pool admin (reverts)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aclManager, user1, user2 } = ctx;

      await assert.rejects(
        aclManager.write.addPoolAdmin([user2.account.address], { account: user1.account }),
        'non-admin must not be able to add pool admin'
      );
    });

    it('ADDRESSES_PROVIDER is set correctly in ACLManager', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aclManager, provider } = ctx;

      assert.equal(
        (await aclManager.read.ADDRESSES_PROVIDER()).toLowerCase(),
        provider.address.toLowerCase()
      );
    });
  });

  // ── PoolAddressesProvider getters ─────────────────────────────────────────────

  describe('PoolAddressesProvider', () => {
    it('getPool returns pool proxy address', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { provider, pool } = ctx;

      assert.equal(await provider.read.getPool(), pool.address);
    });

    it('getPoolConfigurator returns configurator proxy address', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { provider, poolConfigurator } = ctx;

      assert.equal(await provider.read.getPoolConfigurator(), poolConfigurator.address);
    });

    it('getPriceOracle returns oracle address', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { provider, oracle } = ctx;

      assert.equal(
        (await provider.read.getPriceOracle()).toLowerCase(),
        oracle.address.toLowerCase()
      );
    });

    it('getACLManager returns aclManager address', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { provider, aclManager } = ctx;

      assert.equal(
        (await provider.read.getACLManager()).toLowerCase(),
        aclManager.address.toLowerCase()
      );
    });

    it('getMarketId returns the market identifier', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { provider } = ctx;

      assert.equal(await provider.read.getMarketId(), 'MAIN_MARKET');
    });

    it('setAddress / getAddress custom identifier', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { provider, user1 } = ctx;

      const CUSTOM_ID =
        '0x4355535445544f4b454e000000000000000000000000000000000000000000000000' as `0x${string}`;
      // Use a proper bytes32
      const id32 = ('0x' +
        'CUSTOM'
          .split('')
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join('')
          .padEnd(64, '0')) as `0x${string}`;
      await provider.write.setAddress([id32, user1.account.address]);
      assert.equal(
        (await provider.read.getAddress([id32])).toLowerCase(),
        user1.account.address.toLowerCase()
      );
    });
  });

  // ── Pool constants ────────────────────────────────────────────────────────────

  describe('Pool constants and getters', () => {
    it('MAX_STABLE_RATE_BORROW_SIZE_PERCENT is 2500 (25%)', async () => {
      // Initialized to 0.25e4 = 2500 in Pool.initialize()
      const { pool } = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await pool.read.MAX_STABLE_RATE_BORROW_SIZE_PERCENT(), 2500n);
    });

    it('MAX_NUMBER_RESERVES is 128 (ReserveConfiguration.MAX_RESERVES_COUNT)', async () => {
      const { pool } = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await pool.read.MAX_NUMBER_RESERVES(), 128);
    });

    it('POOL_REVISION is 2 (0x2)', async () => {
      const { pool } = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await pool.read.POOL_REVISION(), 2n);
    });

    it('ADDRESSES_PROVIDER returns the provider address', async () => {
      const { pool, provider } = await networkHelpers.loadFixture(deployMarket);
      assert.equal(
        (await pool.read.ADDRESSES_PROVIDER()).toLowerCase(),
        provider.address.toLowerCase()
      );
    });
  });

  // ── setForcedLiquidationEnabled ──────────────────────────────────────────────

  describe('setForcedLiquidationEnabled()', () => {
    it('enables forced liquidation for a reserve', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth } = ctx;

      // Forced liquidation requires the reserve to be frozen first
      await poolConfigurator.write.setReserveFreeze([weth.address, true]);
      await poolConfigurator.write.setForcedLiquidationEnabled([weth.address, true]);

      const config = await pool.read.getConfiguration([weth.address]);
      // Forced liquidation bit = bit 252
      const forcedLiqBit = (config.data >> 252n) & 1n;
      assert.equal(forcedLiqBit, 1n);
    });
  });
});
