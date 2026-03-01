/**
 * E2E — Edge Cases
 *
 * Covers:
 *   - PoolLogic.sol lines 57-59: executeAddReserveToList fills null slot (after dropReserve)
 *   - PoolLogic.sol line 95: executeMintToTreasury skips inactive reserve (continue branch)
 *   - GenericLogic.sol lines 95-96, 98: calculateUserAccountData skips null reserve slot
 *   - ValidationLogic.sol lines 689-698: validateSetUseEModeCategory loop when user is borrowing
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE, ZERO_ADDR } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

describe('E2E: Edge Cases', () => {
  // ── PoolLogic: null slot filled when adding reserve after drop ────────────

  describe('PoolLogic null-slot path (lines 57-59)', () => {
    it('initializing a reserve fills the null slot left by a dropped reserve', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const {
        poolConfigurator,
        pool,
        aTokenImpl,
        stableDebtImpl,
        varDebtImpl,
        wethStrategy,
        oracle,
        deployer,
      } = ctx;

      // Drop DAI (id=2, no suppliers) — creates a null slot in reservesList[2]
      await poolConfigurator.write.dropReserve([ctx.dai.address]);

      // Deploy a 4th token and register it as a reserve
      // When executeAddReserveToList iterates, reservesList[2] == address(0) → lines 57-59 hit
      const { viem } = await network.connect();
      const newToken = await viem.deployContract('MintableERC20', ['Test Token', 'TEST', 18]);
      await oracle.write.setAssetPrice([newToken.address, 1n * 10n ** 8n]);

      const makeInput = () => ({
        aTokenImpl: aTokenImpl.address,
        stableDebtTokenImpl: stableDebtImpl.address,
        variableDebtTokenImpl: varDebtImpl.address,
        underlyingAssetDecimals: 18,
        interestRateStrategyAddress: wethStrategy.address,
        underlyingAsset: newToken.address,
        treasury: deployer.account.address,
        incentivesController: ZERO_ADDR as `0x${string}`,
        aTokenName: 'Aave TEST',
        aTokenSymbol: 'aTEST',
        variableDebtTokenName: 'Variable Debt TEST',
        variableDebtTokenSymbol: 'variableDebtTEST',
        stableDebtTokenName: 'Stable Debt TEST',
        stableDebtTokenSymbol: 'stableDebtTEST',
        params: '0x' as `0x${string}`,
      });

      await poolConfigurator.write.initReserves([[makeInput()]]);

      // New reserve should occupy slot 2 (the null slot)
      const newReserveAddr = await pool.read.getReserveAddressById([2]);
      assert.equal(
        newReserveAddr.toLowerCase(),
        newToken.address.toLowerCase(),
        'new reserve must fill the null slot at id 2'
      );
    });
  });

  // ── PoolLogic: mintToTreasury skips inactive reserve ─────────────────────

  describe('PoolLogic executeMintToTreasury skips inactive reserve (line 95)', () => {
    it('mintToTreasury with inactive reserve continues without minting (line 95)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, aUsdc, usdc, deployer } = ctx;

      // Deactivate USDC (no suppliers in fixture so _checkNoSuppliers passes)
      await poolConfigurator.write.setReserveActive([usdc.address, false]);

      // mintToTreasury with inactive USDC → executeMintToTreasury line 95: !getActive() → continue
      const treasuryBefore = await aUsdc.read.balanceOf([deployer.account.address]);
      await pool.write.mintToTreasury([[usdc.address]]);
      const treasuryAfter = await aUsdc.read.balanceOf([deployer.account.address]);

      // No minting should happen for inactive reserve
      assert.equal(treasuryAfter, treasuryBefore, 'inactive reserve must not mint to treasury');
    });
  });

  // ── GenericLogic: calculateUserAccountData skips null reserve slot ────────

  describe('GenericLogic null slot in reserves list (lines 95-96, 98)', () => {
    it('getUserAccountData after dropping a reserve skips the null slot (lines 95-96, 98)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      // user1 supplies WETH (it has a non-zero position)
      await weth.write.mint([user1.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 5n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Drop DAI (no suppliers) — creates reservesList[2] == address(0)
      await poolConfigurator.write.dropReserve([ctx.dai.address]);

      // calculateUserAccountData iterates reserves including null slot:
      //   reservesList[2] == address(0) → lines 95-96 (++vars.i) and 98 (continue) are hit
      const data = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(data[0] > 0n, 'user1 must still have collateral after DAI drop');
    });
  });

  // ── ValidationLogic: setUserEMode loop when user is borrowing ─────────────

  describe('ValidationLogic.validateSetUseEModeCategory loop (lines 689-698)', () => {
    it('setUserEMode succeeds when all borrowed assets belong to the eMode category', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Create eMode category 1 with USDC in it
      await poolConfigurator.write.setEModeCategory([
        1n,
        9500n,
        9700n,
        10100n,
        ZERO_ADDR as `0x${string}`,
        'UsdStable',
      ]);
      await poolConfigurator.write.setAssetEModeCategory([usdc.address, 1n]);
      await poolConfigurator.write.setAssetEModeCategory([weth.address, 1n]);

      // Seed USDC liquidity for borrowing
      const liq = 10_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      // user1 supplies WETH and borrows USDC (USDC is in eMode 1)
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });
      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // user1 now calls setUserEMode(1) while borrowing USDC (in eMode 1).
      // validateSetUseEModeCategory: user is borrowing so loop executes (lines 691-698):
      //   isBorrowing(usdcId) = true → check USDC.getEModeCategory() == 1 → passes
      await pool.write.setUserEMode([1n], { account: user1.account });

      // Verify eMode was set
      const userEMode = await pool.read.getUserEMode([user1.account.address]);
      assert.equal(userEMode, 1n, 'user eMode must be set to 1');
    });
  });
});
