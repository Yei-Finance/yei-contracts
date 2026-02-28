/**
 * E2E — Bridge Operations
 *
 * Covers:
 *   - Pool.sol modifiers: onlyBridge (lines 64-66, 83-87)
 *   - Pool.sol mintUnbacked (lines 115-130)
 *   - Pool.sol backUnbacked (lines 132-140)
 *   - BridgeLogic.executeMintUnbacked
 *   - BridgeLogic.executeBackUnbacked
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

describe('E2E: Bridge Operations', () => {
  // ── mintUnbacked ──────────────────────────────────────────────────────────────

  describe('mintUnbacked()', () => {
    it('bridge can mint unbacked aTokens for a user', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, aclManager, weth, aWeth, user1, deployer } = ctx;

      // Set unbacked mint cap (required by executeMintUnbacked)
      await poolConfigurator.write.setUnbackedMintCap([weth.address, 1000n]); // 1000 WETH

      // Grant bridge role to deployer
      await aclManager.write.addBridge([deployer.account.address]);

      const aWethBefore = await aWeth.read.balanceOf([user1.account.address]);

      // Bridge mints 1 WETH unbacked for user1
      await pool.write.mintUnbacked([weth.address, WAD, user1.account.address, 0]);

      const aWethAfter = await aWeth.read.balanceOf([user1.account.address]);
      assert.ok(aWethAfter > aWethBefore, 'user1 must receive aWETH from mintUnbacked');
    });

    it('non-bridge cannot call mintUnbacked', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, user1 } = ctx;

      // user1 is not a bridge
      await assert.rejects(
        pool.write.mintUnbacked([weth.address, WAD, user1.account.address, 0], {
          account: user1.account,
        }),
        'non-bridge must not call mintUnbacked'
      );
    });
  });

  // ── backUnbacked ──────────────────────────────────────────────────────────────

  describe('backUnbacked()', () => {
    it('bridge can back previously minted unbacked tokens', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, aclManager, weth, aWeth, user1, deployer } = ctx;

      // Set unbacked mint cap
      await poolConfigurator.write.setUnbackedMintCap([weth.address, 1000n]);

      // Grant bridge role
      await aclManager.write.addBridge([deployer.account.address]);

      // First: mint unbacked
      const mintAmt = WAD;
      await pool.write.mintUnbacked([weth.address, mintAmt, user1.account.address, 0]);

      // Check unbacked amount
      const reserveData = await pool.read.getReserveData([weth.address]);
      assert.ok(reserveData.unbacked > 0n, 'unbacked must be set after mintUnbacked');

      // Bridge now backs the unbacked tokens (pool calls WETH.transferFrom(bridge, aToken, amount))
      // The deployer/bridge must approve the pool contract as spender
      await weth.write.mint([deployer.account.address, mintAmt]);
      await weth.write.approve([pool.address, mintAmt]);

      const backed = await pool.write.backUnbacked([weth.address, mintAmt, 0n]);

      // unbacked should be cleared
      const reserveDataAfter = await pool.read.getReserveData([weth.address]);
      assert.equal(reserveDataAfter.unbacked, 0n, 'unbacked must be 0 after backUnbacked');
    });

    it('non-bridge cannot call backUnbacked', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, user1 } = ctx;

      await assert.rejects(
        pool.write.backUnbacked([weth.address, WAD, 0n], { account: user1.account }),
        'non-bridge must not call backUnbacked'
      );
    });
  });
});
