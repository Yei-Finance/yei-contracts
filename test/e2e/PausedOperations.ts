/**
 * E2E — Paused Operations
 *
 * Covers pool-level pause (setPoolPause) and per-reserve pause (setReservePause)
 * for all protocol operations:
 *   - withdraw, borrow, repay, flash loan, aToken transfer, liquidation
 *
 * Ported from:
 *   - test-suites/pausable-pool.spec.ts
 *   - test-suites/pausable-reserve.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers, viem } = await network.connect();
const MAX_UINT256 = 2n ** 256n - 1n;
const STABLE_RATE_MODE = 1n;

// ── Setup helpers ─────────────────────────────────────────────────────────────

async function seedLiquidity(ctx: Awaited<ReturnType<typeof deployMarket>>) {
  const { pool, usdc, weth, deployer, user1 } = ctx;

  const usdcLiq = 1_000_000n * 10n ** 6n;
  await usdc.write.mint([deployer.account.address, usdcLiq]);
  await usdc.write.approve([pool.address, usdcLiq]);
  await pool.write.supply([usdc.address, usdcLiq, deployer.account.address, 0]);

  const wethAmt = 10n * WAD;
  await weth.write.mint([user1.account.address, wethAmt]);
  await weth.write.approve([pool.address, wethAmt], { account: user1.account });
  await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
    account: user1.account,
  });
}

async function setupLiquidatablePosition(ctx: Awaited<ReturnType<typeof deployMarket>>) {
  const { pool, oracle, weth, usdc, user1, deployer, liquidator } = ctx;
  await seedLiquidity(ctx);

  // user1 borrows 16,000 USDC against 10 WETH ($20,000 collateral)
  const borrowAmt = 16_000n * 10n ** 6n;
  await pool.write.borrow([usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address], {
    account: user1.account,
  });

  // Drop WETH price → HF < 1
  await oracle.write.setAssetPrice([weth.address, 1_000n * 10n ** 8n]);

  // Give liquidator USDC
  await usdc.write.mint([liquidator.account.address, 10_000n * 10n ** 6n]);
  await usdc.write.approve([pool.address, 10_000n * 10n ** 6n], {
    account: liquidator.account,
  });
}

// ── Pool-level pause ──────────────────────────────────────────────────────────

describe('E2E: Paused Operations — setPoolPause()', () => {
  // ── withdraw ─────────────────────────────────────────────────────────────────

  describe('withdraw() when pool is paused', () => {
    it('paused pool prevents withdraw', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setPoolPause([true]);

      await assert.rejects(
        pool.write.withdraw([weth.address, amt, user1.account.address], {
          account: user1.account,
        }),
        'withdraw must revert when pool is paused'
      );
    });

    it('unpaused pool allows withdraw', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setPoolPause([true]);
      await poolConfigurator.write.setPoolPause([false]);

      await pool.write.withdraw([weth.address, amt, user1.account.address], {
        account: user1.account,
      });

      const bal = await weth.read.balanceOf([user1.account.address]);
      assert.equal(bal, amt);
    });
  });

  // ── borrow ───────────────────────────────────────────────────────────────────

  describe('borrow() when pool is paused', () => {
    it('paused pool prevents variable borrow', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, weth, user1, deployer } = ctx;
      await seedLiquidity(ctx);

      await poolConfigurator.write.setPoolPause([true]);

      await assert.rejects(
        pool.write.borrow(
          [usdc.address, 100n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
          { account: user1.account }
        ),
        'borrow must revert when pool is paused'
      );
    });

    it('unpaused pool allows borrow', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, user1 } = ctx;
      await seedLiquidity(ctx);

      await poolConfigurator.write.setPoolPause([true]);
      await poolConfigurator.write.setPoolPause([false]);

      await pool.write.borrow(
        [usdc.address, 100n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );
    });
  });

  // ── repay ─────────────────────────────────────────────────────────────────────

  describe('repay() when pool is paused', () => {
    it('paused pool prevents repay', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, user1 } = ctx;
      await seedLiquidity(ctx);

      const borrowAmt = 100n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      await usdc.write.approve([pool.address, borrowAmt], { account: user1.account });
      await poolConfigurator.write.setPoolPause([true]);

      await assert.rejects(
        pool.write.repay([usdc.address, borrowAmt, VARIABLE_RATE_MODE, user1.account.address], {
          account: user1.account,
        }),
        'repay must revert when pool is paused'
      );
    });

    it('unpaused pool allows repay', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, user1 } = ctx;
      await seedLiquidity(ctx);

      const borrowAmt = 100n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      await usdc.write.approve([pool.address, borrowAmt], { account: user1.account });
      await poolConfigurator.write.setPoolPause([true]);
      await poolConfigurator.write.setPoolPause([false]);

      await pool.write.repay([usdc.address, borrowAmt, VARIABLE_RATE_MODE, user1.account.address], {
        account: user1.account,
      });
    });
  });

  // ── flash loan ────────────────────────────────────────────────────────────────

  describe('flashLoan() when pool is paused', () => {
    it('paused pool prevents flashLoan', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, deployer } = ctx;

      const liq = 10n * WAD;
      await weth.write.mint([deployer.account.address, liq]);
      await weth.write.approve([pool.address, liq]);
      await pool.write.supply([weth.address, liq, deployer.account.address, 0]);

      const receiver = await viem.deployContract('MockFlashLoanReceiver', [ctx.provider.address]);
      await poolConfigurator.write.setPoolPause([true]);

      await assert.rejects(
        pool.write.flashLoan([
          receiver.address,
          [weth.address],
          [WAD],
          [0],
          deployer.account.address,
          '0x',
          0,
        ]),
        'flashLoan must revert when pool is paused'
      );
    });

    it('paused pool prevents flashLoanSimple', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, deployer } = ctx;

      const liq = 10n * WAD;
      await weth.write.mint([deployer.account.address, liq]);
      await weth.write.approve([pool.address, liq]);
      await pool.write.supply([weth.address, liq, deployer.account.address, 0]);

      const receiver = await viem.deployContract('MockFlashLoanSimpleReceiver', [
        ctx.provider.address,
      ]);
      await poolConfigurator.write.setPoolPause([true]);

      await assert.rejects(
        pool.write.flashLoanSimple([receiver.address, weth.address, WAD, '0x', 0]),
        'flashLoanSimple must revert when pool is paused'
      );
    });

    it('unpaused pool allows flashLoan', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, deployer } = ctx;

      const liq = 10n * WAD;
      await weth.write.mint([deployer.account.address, liq]);
      await weth.write.approve([pool.address, liq]);
      await pool.write.supply([weth.address, liq, deployer.account.address, 0]);

      const receiver = await viem.deployContract('MockFlashLoanReceiver', [ctx.provider.address]);
      await poolConfigurator.write.setPoolPause([true]);
      await poolConfigurator.write.setPoolPause([false]);

      await pool.write.flashLoan([
        receiver.address,
        [weth.address],
        [WAD],
        [0],
        deployer.account.address,
        '0x',
        0,
      ]);
    });
  });

  // ── aToken transfer ───────────────────────────────────────────────────────────

  describe('aToken.transfer() when pool is paused', () => {
    it('paused pool prevents aToken transfer', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, aWeth, user1, user2 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setPoolPause([true]);

      await assert.rejects(
        aWeth.write.transfer([user2.account.address, amt], { account: user1.account }),
        'aToken transfer must revert when pool is paused'
      );
    });

    it('unpaused pool allows aToken transfer', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, aWeth, user1, user2 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setPoolPause([true]);
      await poolConfigurator.write.setPoolPause([false]);

      // Disable collateral first so transfer doesn't trigger HF check
      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });

      await aWeth.write.transfer([user2.account.address, amt], { account: user1.account });
      const bal2 = await aWeth.read.scaledBalanceOf([user2.account.address]);
      assert.ok(bal2 > 0n, 'user2 must receive aTokens');
    });
  });

  // ── liquidation ───────────────────────────────────────────────────────────────

  describe('liquidationCall() when pool is paused', () => {
    it('paused pool prevents liquidation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, liquidator } = ctx;
      await setupLiquidatablePosition(ctx);

      const data = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(data[5] < 10n ** 18n, 'HF must be < 1 before pause test');

      await poolConfigurator.write.setPoolPause([true]);

      await assert.rejects(
        pool.write.liquidationCall(
          [weth.address, usdc.address, user1.account.address, MAX_UINT256, false],
          { account: liquidator.account }
        ),
        'liquidationCall must revert when pool is paused'
      );
    });

    it('unpaused pool allows liquidation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, varDebtUsdc, user1, liquidator } = ctx;
      await setupLiquidatablePosition(ctx);

      await poolConfigurator.write.setPoolPause([true]);
      await poolConfigurator.write.setPoolPause([false]);

      const debtBefore = await varDebtUsdc.read.balanceOf([user1.account.address]);
      await pool.write.liquidationCall(
        [weth.address, usdc.address, user1.account.address, MAX_UINT256, false],
        { account: liquidator.account }
      );
      const debtAfter = await varDebtUsdc.read.balanceOf([user1.account.address]);
      assert.ok(debtAfter < debtBefore, 'debt must decrease after liquidation');
    });
  });
});

// ── Per-reserve pause ─────────────────────────────────────────────────────────

describe('E2E: Paused Operations — setReservePause()', () => {
  // ── withdraw ─────────────────────────────────────────────────────────────────

  describe('withdraw() when reserve is paused', () => {
    it('paused reserve prevents withdraw', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setReservePause([weth.address, true]);

      await assert.rejects(
        pool.write.withdraw([weth.address, amt, user1.account.address], {
          account: user1.account,
        }),
        'withdraw must revert when reserve is paused'
      );
    });

    it('unpaused reserve allows withdraw', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setReservePause([weth.address, true]);
      await poolConfigurator.write.setReservePause([weth.address, false]);

      await pool.write.withdraw([weth.address, amt, user1.account.address], {
        account: user1.account,
      });
      assert.equal(await weth.read.balanceOf([user1.account.address]), amt);
    });
  });

  // ── borrow ───────────────────────────────────────────────────────────────────

  describe('borrow() when reserve is paused', () => {
    it('paused reserve prevents variable borrow', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, user1 } = ctx;
      await seedLiquidity(ctx);

      await poolConfigurator.write.setReservePause([usdc.address, true]);

      await assert.rejects(
        pool.write.borrow(
          [usdc.address, 100n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
          { account: user1.account }
        ),
        'borrow must revert when reserve is paused'
      );
    });

    it('pausing one reserve does not prevent borrowing another', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, dai, user1, deployer } = ctx;
      await seedLiquidity(ctx);

      // Also seed DAI liquidity
      const daiLiq = 100_000n * WAD;
      await dai.write.mint([deployer.account.address, daiLiq]);
      await dai.write.approve([pool.address, daiLiq]);
      await pool.write.supply([dai.address, daiLiq, deployer.account.address, 0]);

      // Pause USDC only
      await poolConfigurator.write.setReservePause([usdc.address, true]);

      // DAI borrow should still work
      await pool.write.borrow(
        [dai.address, 100n * WAD, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );
    });
  });

  // ── repay ─────────────────────────────────────────────────────────────────────

  describe('repay() when reserve is paused', () => {
    it('paused reserve prevents repay', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, user1 } = ctx;
      await seedLiquidity(ctx);

      const borrowAmt = 100n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      await usdc.write.approve([pool.address, borrowAmt], { account: user1.account });
      await poolConfigurator.write.setReservePause([usdc.address, true]);

      await assert.rejects(
        pool.write.repay([usdc.address, borrowAmt, VARIABLE_RATE_MODE, user1.account.address], {
          account: user1.account,
        }),
        'repay must revert when reserve is paused'
      );
    });

    it('unpaused reserve allows repay', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, varDebtUsdc, user1 } = ctx;
      await seedLiquidity(ctx);

      const borrowAmt = 100n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      await poolConfigurator.write.setReservePause([usdc.address, true]);
      await poolConfigurator.write.setReservePause([usdc.address, false]);

      // Mint extra to cover accrued interest and repay with MAX_UINT256
      const MAX_UINT256 = 2n ** 256n - 1n;
      await usdc.write.mint([user1.account.address, 10n * 10n ** 6n]);
      await usdc.write.approve([pool.address, MAX_UINT256], { account: user1.account });
      await pool.write.repay(
        [usdc.address, MAX_UINT256, VARIABLE_RATE_MODE, user1.account.address],
        {
          account: user1.account,
        }
      );
      const scaledDebt = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);
      assert.equal(scaledDebt, 0n);
    });
  });

  // ── flash loan ────────────────────────────────────────────────────────────────

  describe('flashLoan() when specific reserve is paused', () => {
    it('pausing WETH prevents flash loan of WETH', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, deployer } = ctx;

      const liq = 10n * WAD;
      await weth.write.mint([deployer.account.address, liq]);
      await weth.write.approve([pool.address, liq]);
      await pool.write.supply([weth.address, liq, deployer.account.address, 0]);

      const receiver = await viem.deployContract('MockFlashLoanReceiver', [ctx.provider.address]);
      await poolConfigurator.write.setReservePause([weth.address, true]);

      await assert.rejects(
        pool.write.flashLoan([
          receiver.address,
          [weth.address],
          [WAD],
          [0],
          deployer.account.address,
          '0x',
          0,
        ]),
        'flashLoan must revert when the reserve is paused'
      );
    });
  });

  // ── aToken transfer ───────────────────────────────────────────────────────────

  describe('aToken.transfer() when reserve is paused', () => {
    it('paused reserve prevents aToken transfer', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, aWeth, user1, user2 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setReservePause([weth.address, true]);

      await assert.rejects(
        aWeth.write.transfer([user2.account.address, amt], { account: user1.account }),
        'aToken transfer must revert when reserve is paused'
      );
    });

    it('unpaused reserve allows aToken transfer', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, aWeth, user1, user2 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setReservePause([weth.address, true]);
      await poolConfigurator.write.setReservePause([weth.address, false]);

      // Disable collateral so transfer doesn't trigger HF check
      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });

      await aWeth.write.transfer([user2.account.address, amt], { account: user1.account });
      const bal2 = await aWeth.read.scaledBalanceOf([user2.account.address]);
      assert.ok(bal2 > 0n, 'user2 must receive aTokens');
    });
  });

  // ── liquidation ───────────────────────────────────────────────────────────────

  describe('liquidationCall() when collateral or debt reserve is paused', () => {
    it('paused collateral reserve (WETH) prevents liquidation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, liquidator } = ctx;
      await setupLiquidatablePosition(ctx);

      await poolConfigurator.write.setReservePause([weth.address, true]);

      await assert.rejects(
        pool.write.liquidationCall(
          [weth.address, usdc.address, user1.account.address, MAX_UINT256, false],
          { account: liquidator.account }
        ),
        'liquidationCall must revert when collateral reserve is paused'
      );
    });

    it('paused debt reserve (USDC) prevents liquidation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, liquidator } = ctx;
      await setupLiquidatablePosition(ctx);

      await poolConfigurator.write.setReservePause([usdc.address, true]);

      await assert.rejects(
        pool.write.liquidationCall(
          [weth.address, usdc.address, user1.account.address, MAX_UINT256, false],
          { account: liquidator.account }
        ),
        'liquidationCall must revert when debt reserve is paused'
      );
    });
  });
});
