/**
 * E2E — Rescue Tokens
 *
 * Covers:
 *   - Pool.rescueTokens(): non-admin reverts, admin succeeds
 *   - AToken.rescueTokens(): non-admin reverts, admin cannot rescue underlying, admin can rescue other tokens
 *
 * Ported from test-suites/rescue-tokens.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

describe('E2E: Rescue Tokens', () => {
  // ── Pool.rescueTokens() ──────────────────────────────────────────────────────

  describe('Pool.rescueTokens()', () => {
    it('non-admin cannot rescue tokens from Pool', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, user1 } = ctx;

      await assert.rejects(
        pool.write.rescueTokens([usdc.address, user1.account.address, 1n], {
          account: user1.account,
        }),
        'rescueTokens from Pool must revert for non-admin'
      );
    });

    it('pool admin can rescue accidentally locked tokens from Pool', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, deployer, user1 } = ctx;

      // Lock USDC in Pool by direct transfer (not through supply)
      const lockAmt = 100n * 10n ** 6n;
      await usdc.write.mint([user1.account.address, lockAmt]);
      await usdc.write.transfer([pool.address, lockAmt], { account: user1.account });

      const poolBalBefore = await usdc.read.balanceOf([pool.address]);
      const receiverBalBefore = await usdc.read.balanceOf([user1.account.address]);

      // Admin rescues
      await pool.write.rescueTokens([usdc.address, user1.account.address, lockAmt]);

      const poolBalAfter = await usdc.read.balanceOf([pool.address]);
      const receiverBalAfter = await usdc.read.balanceOf([user1.account.address]);

      assert.equal(
        poolBalAfter,
        poolBalBefore - lockAmt,
        'pool balance must decrease by rescued amount'
      );
      assert.equal(
        receiverBalAfter,
        receiverBalBefore + lockAmt,
        'receiver must get rescued tokens'
      );
    });

    it('pool admin can rescue WETH locked in Pool', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, deployer, user1 } = ctx;

      const lockAmt = WAD;
      await weth.write.mint([user1.account.address, lockAmt]);
      await weth.write.transfer([pool.address, lockAmt], { account: user1.account });

      const poolBalBefore = await weth.read.balanceOf([pool.address]);

      await pool.write.rescueTokens([weth.address, deployer.account.address, lockAmt]);

      const poolBalAfter = await weth.read.balanceOf([pool.address]);
      assert.equal(poolBalAfter, poolBalBefore - lockAmt);
      assert.equal(await weth.read.balanceOf([deployer.account.address]), lockAmt);
    });
  });

  // ── AToken.rescueTokens() ─────────────────────────────────────────────────────

  describe('AToken.rescueTokens()', () => {
    it('non-admin cannot rescue tokens from AToken', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, usdc, user1 } = ctx;

      await assert.rejects(
        aWeth.write.rescueTokens([usdc.address, user1.account.address, 1n], {
          account: user1.account,
        }),
        'rescueTokens from AToken must revert for non-admin'
      );
    });

    it('pool admin cannot rescue the underlying token from its own AToken', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, weth, deployer } = ctx;

      // Try to rescue WETH from aWETH (underlying)
      await assert.rejects(
        aWeth.write.rescueTokens([weth.address, deployer.account.address, 1n]),
        'admin must not be able to rescue underlying from its aToken'
      );
    });

    it('pool admin can rescue non-underlying tokens locked in AToken', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, usdc, deployer, user1 } = ctx;

      // Lock USDC inside aWETH by direct transfer
      const lockAmt = 10n * 10n ** 6n; // 10 USDC
      await usdc.write.mint([user1.account.address, lockAmt]);
      await usdc.write.transfer([aWeth.address, lockAmt], { account: user1.account });

      const aTokenBalBefore = await usdc.read.balanceOf([aWeth.address]);
      const receiverBalBefore = await usdc.read.balanceOf([user1.account.address]);

      // Admin rescues USDC from aWETH
      await aWeth.write.rescueTokens([usdc.address, user1.account.address, lockAmt]);

      const aTokenBalAfter = await usdc.read.balanceOf([aWeth.address]);
      const receiverBalAfter = await usdc.read.balanceOf([user1.account.address]);

      assert.equal(
        aTokenBalAfter,
        aTokenBalBefore - lockAmt,
        'aToken USDC balance must decrease by rescued amount'
      );
      assert.equal(receiverBalAfter, receiverBalBefore + lockAmt, 'receiver must get rescued USDC');
    });

    it('pool admin can rescue DAI locked in aUSDC', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aUsdc, dai, deployer, user1 } = ctx;

      const lockAmt = 50n * WAD;
      await dai.write.mint([user1.account.address, lockAmt]);
      await dai.write.transfer([aUsdc.address, lockAmt], { account: user1.account });

      const balBefore = await dai.read.balanceOf([user1.account.address]);
      await aUsdc.write.rescueTokens([dai.address, user1.account.address, lockAmt]);
      const balAfter = await dai.read.balanceOf([user1.account.address]);

      assert.equal(balAfter, balBefore + lockAmt);
    });

    it('non-admin cannot rescue underlying from AToken (CALLER_NOT_POOL_ADMIN precedes UNDERLYING_CANNOT_BE_RESCUED)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, weth, user1 } = ctx;

      await assert.rejects(
        aWeth.write.rescueTokens([weth.address, user1.account.address, 1n], {
          account: user1.account,
        }),
        'non-admin rescuing underlying must revert with CALLER_NOT_POOL_ADMIN'
      );
    });
  });
});
