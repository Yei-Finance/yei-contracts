/**
 * E2E — Drop Reserve
 *
 * Covers:
 *   - PoolConfigurator.dropReserve() fails when aToken supply exists
 *   - dropReserve() fails when variable debt exists
 *   - dropReserve() fails when stable debt exists
 *   - dropReserve() succeeds after all debt repaid and supply withdrawn
 *   - dropReserve() fails for an unlisted asset
 *   - dropReserve() fails for zero address
 *   - After drop, reserve is removed from getReservesList()
 *
 * Ported from test-suites/pool-drop-reserve.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();
const MAX_UINT256 = 2n ** 256n - 1n;
const STABLE_RATE_MODE = 1n;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

describe('E2E: Drop Reserve', () => {
  // ── basic success case ────────────────────────────────────────────────────────

  describe('dropReserve() — success after full cleanup', () => {
    it('successfully drops a reserve after all suppliers have withdrawn and debtors repaid', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, dai, user1, deployer } = ctx;

      // ── Step 1: Enable stable rate on USDC (to test stable debt path) ──────
      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      // ── Step 2: Deployer deposits USDC ─────────────────────────────────────
      const depositAmt = 10_000n * 10n ** 6n; // 10,000 USDC
      await usdc.write.mint([deployer.account.address, depositAmt]);
      await usdc.write.approve([pool.address, depositAmt]);
      await pool.write.supply([usdc.address, depositAmt, deployer.account.address, 0]);

      // ── Step 3: user1 posts WETH collateral ────────────────────────────────
      const wethAmt = 10n * WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      // ── Step 4: user1 borrows USDC variable ────────────────────────────────
      const varBorrow = 1_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, varBorrow, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // ── Step 5: user1 borrows USDC stable ──────────────────────────────────
      const stableBorrow = 500n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, stableBorrow, STABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // ── Step 6: Try to drop while variable and stable debt exists → fails ──
      await assert.rejects(
        poolConfigurator.write.dropReserve([usdc.address]),
        'dropReserve must fail while variable+stable debt exists'
      );

      // ── Step 7: Repay stable debt ───────────────────────────────────────────
      // Mint extra to cover accrued interest
      await usdc.write.mint([user1.account.address, 100n * 10n ** 6n]);
      await usdc.write.approve([pool.address, MAX_UINT256], { account: user1.account });
      await pool.write.repay([usdc.address, MAX_UINT256, STABLE_RATE_MODE, user1.account.address], {
        account: user1.account,
      });

      // ── Step 8: Drop still fails (variable debt remains) ───────────────────
      await assert.rejects(
        poolConfigurator.write.dropReserve([usdc.address]),
        'dropReserve must fail while variable debt still exists'
      );

      // ── Step 9: Repay variable debt ─────────────────────────────────────────
      await usdc.write.mint([user1.account.address, 100n * 10n ** 6n]);
      await pool.write.repay(
        [usdc.address, MAX_UINT256, VARIABLE_RATE_MODE, user1.account.address],
        {
          account: user1.account,
        }
      );

      // ── Step 10: Drop still fails (deployer's aToken supply remains) ────────
      await assert.rejects(
        poolConfigurator.write.dropReserve([usdc.address]),
        'dropReserve must fail while aToken supply exists'
      );

      // ── Step 11: Deployer withdraws all USDC ────────────────────────────────
      await pool.write.withdraw([usdc.address, MAX_UINT256, deployer.account.address]);

      // ── Step 12: Drop succeeds ───────────────────────────────────────────────
      const reservesBefore = await pool.read.getReservesList();
      await poolConfigurator.write.dropReserve([usdc.address]);
      const reservesAfter = await pool.read.getReservesList();

      assert.equal(
        reservesAfter.length,
        reservesBefore.length - 1,
        'reserves count must decrease by 1 after drop'
      );
      assert.ok(
        !reservesAfter.map((a: string) => a.toLowerCase()).includes(usdc.address.toLowerCase()),
        'USDC must not be in reserves list after drop'
      );
    });
  });

  // ── fail cases ────────────────────────────────────────────────────────────────

  describe('dropReserve() — fail cases', () => {
    it('fails when aToken supply (underlying claimable rights) exists', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, deployer } = ctx;

      // Deployer deposits USDC → aToken supply exists
      const depositAmt = 1_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, depositAmt]);
      await usdc.write.approve([pool.address, depositAmt]);
      await pool.write.supply([usdc.address, depositAmt, deployer.account.address, 0]);

      await assert.rejects(
        poolConfigurator.write.dropReserve([usdc.address]),
        'dropReserve must fail when aToken supply exists'
      );
    });

    it('fails when variable debt exists', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Deposit USDC for borrowing
      const depositAmt = 10_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, depositAmt]);
      await usdc.write.approve([pool.address, depositAmt]);
      await pool.write.supply([usdc.address, depositAmt, deployer.account.address, 0]);

      // user1 provides collateral
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // user1 borrows variable
      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      await assert.rejects(
        poolConfigurator.write.dropReserve([usdc.address]),
        'dropReserve must fail when variable debt exists'
      );
    });

    it('fails when stable debt exists', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Enable stable borrowing
      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      // Deposit USDC
      const depositAmt = 10_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, depositAmt]);
      await usdc.write.approve([pool.address, depositAmt]);
      await pool.write.supply([usdc.address, depositAmt, deployer.account.address, 0]);

      // user1 provides WETH collateral
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow stable
      await pool.write.borrow(
        [usdc.address, 500n * 10n ** 6n, STABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      await assert.rejects(
        poolConfigurator.write.dropReserve([usdc.address]),
        'dropReserve must fail when stable debt exists'
      );
    });

    it('fails for an unlisted asset', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, user1 } = ctx;

      await assert.rejects(
        poolConfigurator.write.dropReserve([user1.account.address as `0x${string}`]),
        'dropReserve must fail for an unlisted asset'
      );
    });

    it('fails for zero address', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator } = ctx;

      await assert.rejects(
        poolConfigurator.write.dropReserve([ZERO_ADDR]),
        'dropReserve must fail for zero address'
      );
    });
  });

  // ── reserve list integrity ────────────────────────────────────────────────────

  describe('dropReserve() — reserve list integrity', () => {
    it('dropped reserve is no longer returned by getReservesList()', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, dai } = ctx;

      // DAI has no suppliers in the fixture, so it can be dropped
      // (only need to deactivate first if there are no suppliers)
      const reservesBefore = await pool.read.getReservesList();
      assert.ok(
        reservesBefore.map((a: string) => a.toLowerCase()).includes(dai.address.toLowerCase()),
        'DAI must be in list before drop'
      );

      await poolConfigurator.write.dropReserve([dai.address]);

      const reservesAfter = await pool.read.getReservesList();
      assert.ok(
        !reservesAfter.map((a: string) => a.toLowerCase()).includes(dai.address.toLowerCase()),
        'DAI must not be in list after drop'
      );
    });

    it('dropped reserve has isActive=false in configuration', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, dai } = ctx;

      await poolConfigurator.write.dropReserve([dai.address]);

      // pool.read.getConfiguration returns { data: bigint }
      // bit 56 is the isActive flag
      const cfg = await pool.read.getConfiguration([dai.address]);
      const isActive = (cfg.data >> 56n) & 1n;
      assert.equal(isActive, 0n, 'reserve must be inactive (bit 56 = 0) after drop');
    });
  });
});
