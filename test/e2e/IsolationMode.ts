/**
 * E2E — Isolation Mode
 *
 * Covers:
 *   - IsolationModeLogic.updateIsolatedDebtIfIsolated (both branches)
 *   - BorrowLogic isolation debt tracking on borrow
 *   - ValidationLogic isolation mode validation (borrowable check, debt ceiling)
 *   - PoolLogic.executeResetIsolationModeTotalDebt
 *   - PoolConfigurator.setDebtCeiling resetting isolation debt (line 262)
 *
 * Key note: isolation-mode assets (debt ceiling > 0) are NOT automatically enabled as
 * collateral on supply — validateAutomaticUseAsCollateral returns false unless the caller
 * holds ISOLATED_COLLATERAL_SUPPLIER_ROLE. Users must explicitly call
 * pool.setUserUseReserveAsCollateral after supplying an isolation-mode asset.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

async function setupIsolation(ctx: Awaited<ReturnType<typeof deployMarket>>) {
  const { poolConfigurator, weth, usdc } = ctx;
  // debt ceiling 1,000,000 (= $10,000.00 in Aave's 2-decimal USD units)
  await poolConfigurator.write.setDebtCeiling([weth.address, 1_000_000n]);
  await poolConfigurator.write.setBorrowableInIsolation([usdc.address, true]);
}

/** Supply WETH as isolation collateral + explicitly enable it as collateral. */
async function supplyIsolationCollateral(
  ctx: Awaited<ReturnType<typeof deployMarket>>,
  amt: bigint
) {
  const { pool, weth, user1 } = ctx;
  await weth.write.mint([user1.account.address, amt]);
  await weth.write.approve([pool.address, amt], { account: user1.account });
  await pool.write.supply([weth.address, amt, user1.account.address, 0], {
    account: user1.account,
  });
  // Must explicitly enable as collateral for isolation-mode assets
  await pool.write.setUserUseReserveAsCollateral([weth.address, true], { account: user1.account });
}

describe('E2E: Isolation Mode', () => {
  // ── borrow in isolation mode ─────────────────────────────────────────────────

  describe('borrow in isolation mode', () => {
    it('user can borrow an asset marked borrowable-in-isolation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer } = ctx;
      await setupIsolation(ctx);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await supplyIsolationCollateral(ctx, 5n * WAD);

      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      const wethReserve = await pool.read.getReserveData([weth.address]);
      assert.ok(
        wethReserve.isolationModeTotalDebt > 0n,
        'isolation debt must be non-zero after borrow'
      );
    });

    it('user in isolation mode cannot borrow an asset NOT marked borrowable-in-isolation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, dai, user1, deployer } = ctx;
      await setupIsolation(ctx);

      const liq = 1_000_000n * WAD;
      await dai.write.mint([deployer.account.address, liq]);
      await dai.write.approve([pool.address, liq]);
      await pool.write.supply([dai.address, liq, deployer.account.address, 0]);

      await supplyIsolationCollateral(ctx, 5n * WAD);

      await assert.rejects(
        pool.write.borrow([dai.address, 100n * WAD, VARIABLE_RATE_MODE, 0, user1.account.address], {
          account: user1.account,
        }),
        'borrow of non-isolation-mode asset must revert'
      );
    });

    it('exceeding the debt ceiling reverts', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Low ceiling: $100 = 10_000 in 2-decimal
      await poolConfigurator.write.setDebtCeiling([weth.address, 10_000n]);
      await poolConfigurator.write.setBorrowableInIsolation([usdc.address, true]);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await supplyIsolationCollateral(ctx, 5n * WAD);

      // 101 USDC → 101*10^6/10^4 = 10,100 > 10,000 ceiling → revert
      await assert.rejects(
        pool.write.borrow(
          [usdc.address, 101n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
          { account: user1.account }
        ),
        'borrow over debt ceiling must revert'
      );
    });
  });

  // ── IsolationModeLogic repay branches ────────────────────────────────────────

  describe('IsolationModeLogic.updateIsolatedDebtIfIsolated', () => {
    it('partial repay decrements isolation debt counter (else branch)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer } = ctx;
      await setupIsolation(ctx);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await supplyIsolationCollateral(ctx, 5n * WAD);

      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      const debtBefore = (await pool.read.getReserveData([weth.address])).isolationModeTotalDebt;
      assert.ok(debtBefore > 0n);

      // Partial repay: 500 USDC of 1000 borrowed
      const repayAmt = 500n * 10n ** 6n;
      await usdc.write.approve([pool.address, repayAmt], { account: user1.account });
      await pool.write.repay([usdc.address, repayAmt, VARIABLE_RATE_MODE, user1.account.address], {
        account: user1.account,
      });

      const debtAfter = (await pool.read.getReserveData([weth.address])).isolationModeTotalDebt;
      assert.ok(debtAfter < debtBefore, 'isolation debt must decrease after partial repay');
      assert.ok(debtAfter > 0n, 'partial repay must not zero out isolation debt');
    });

    it('max repay zeros isolation debt counter when accrued interest exceeds tracked debt (if branch)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer } = ctx;
      await setupIsolation(ctx);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await supplyIsolationCollateral(ctx, 5n * WAD);

      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Advance 1 year so that accrued interest > isolationModeTotalDebt
      await networkHelpers.time.increase(365 * 24 * 3600);

      // Fund user1 with extra USDC to cover interest
      const extra = 10_000n * 10n ** 6n;
      await usdc.write.mint([user1.account.address, extra]);
      await usdc.write.approve([pool.address, extra], { account: user1.account });

      // MAX repay: actual debt (principal + interest) > tracked isolationModeTotalDebt
      // → triggers if (isolationModeTotalDebt <= isolatedDebtRepaid) → sets to 0
      await pool.write.repay(
        [usdc.address, 2n ** 256n - 1n, VARIABLE_RATE_MODE, user1.account.address],
        { account: user1.account }
      );

      const debtAfter = (await pool.read.getReserveData([weth.address])).isolationModeTotalDebt;
      assert.equal(
        debtAfter,
        0n,
        'isolation debt must be zeroed out after full repay with accrued interest'
      );
    });
  });

  // ── resetIsolationModeTotalDebt ───────────────────────────────────────────────

  describe('resetIsolationModeTotalDebt / setDebtCeiling to 0', () => {
    it('setDebtCeiling to 0 calls pool.resetIsolationModeTotalDebt and clears debt', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;
      await setupIsolation(ctx);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await supplyIsolationCollateral(ctx, 5n * WAD);

      await pool.write.borrow(
        [usdc.address, 100n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Repay all to clear isolation debt counter
      const extra = 200n * 10n ** 6n;
      await usdc.write.mint([user1.account.address, extra]);
      await usdc.write.approve([pool.address, extra], { account: user1.account });
      await pool.write.repay(
        [usdc.address, 2n ** 256n - 1n, VARIABLE_RATE_MODE, user1.account.address],
        { account: user1.account }
      );

      // Setting debt ceiling to 0 calls pool.resetIsolationModeTotalDebt internally
      await poolConfigurator.write.setDebtCeiling([weth.address, 0n]);
      const debtAfter = (await pool.read.getReserveData([weth.address])).isolationModeTotalDebt;
      assert.equal(debtAfter, 0n, 'isolation debt must be 0 after ceiling removed');
    });

    it('setDebtCeiling to 0 while debt is outstanding resets isolation counter (admin override)', async () => {
      // Demonstrates that resetIsolationModeTotalDebt is called unconditionally when newCeiling=0.
      // Even without user repayment, the admin can reset the counter by removing the ceiling.
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;
      await setupIsolation(ctx);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await supplyIsolationCollateral(ctx, 5n * WAD);
      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Verify isolation debt counter is non-zero
      const debtBefore = (await pool.read.getReserveData([weth.address])).isolationModeTotalDebt;
      assert.ok(debtBefore > 0n, 'isolation debt must be non-zero after borrow');

      // Admin removes debt ceiling (setDebtCeiling to 0) WITHOUT user repaying → forcibly resets counter
      await poolConfigurator.write.setDebtCeiling([weth.address, 0n]);
      const debtAfter = (await pool.read.getReserveData([weth.address])).isolationModeTotalDebt;
      assert.equal(
        debtAfter,
        0n,
        'isolation debt counter must be reset to 0 after ceiling removal'
      );
    });
  });
});
