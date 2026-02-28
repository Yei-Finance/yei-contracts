/**
 * E2E — Flash Loans
 *
 * Covers:
 *   - flashLoanSimple() with MockFlashLoanSimpleReceiver
 *   - flashLoan() multi-asset with MockFlashLoanReceiver
 *   - flashLoan() with interestRateMode=2 (borrow mode — creates debt)
 *   - Flash loan when receiver fails (reverts)
 *   - FLASHLOAN_PREMIUM_TOTAL and FLASHLOAN_PREMIUM_TO_PROTOCOL
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE, ZERO_ADDR } from '../helpers/deployMarket.js';

const { networkHelpers, viem } = await network.connect();

describe('E2E: Flash Loans', () => {
  // ── flashLoanSimple ──────────────────────────────────────────────────────────

  describe('flashLoanSimple()', () => {
    it('simple flash loan succeeds when receiver repays correctly', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, deployer } = ctx;

      // Seed pool with USDC liquidity
      const liquidity = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liquidity]);
      await usdc.write.approve([pool.address, liquidity]);
      await pool.write.supply([usdc.address, liquidity, deployer.account.address, 0]);

      // Deploy simple flash loan receiver
      const receiver = await viem.deployContract('MockFlashLoanSimpleReceiver', [
        ctx.provider.address,
      ]);

      // Flash loan 1,000 USDC (premium = 0 since default is 0)
      const flashAmount = 1_000n * 10n ** 6n;
      await pool.write.flashLoanSimple([receiver.address, usdc.address, flashAmount, '0x', 0]);

      // Pool USDC balance should be unchanged (receiver minted and returned premium)
      const poolBalance = await usdc.read.balanceOf([ctx.aUsdc.address]);
      assert.ok(poolBalance >= liquidity, 'pool must have at least initial liquidity');
    });

    it('simple flash loan fails when receiver returns false', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, deployer } = ctx;

      const liquidity = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liquidity]);
      await usdc.write.approve([pool.address, liquidity]);
      await pool.write.supply([usdc.address, liquidity, deployer.account.address, 0]);

      const receiver = await viem.deployContract('MockFlashLoanSimpleReceiver', [
        ctx.provider.address,
      ]);
      await receiver.write.setFailExecutionTransfer([true]);

      await assert.rejects(
        pool.write.flashLoanSimple([receiver.address, usdc.address, 1_000n * 10n ** 6n, '0x', 0]),
        'flash loan with failing receiver must revert'
      );
    });

    it('flashLoanSimple works with WETH: pool balance restored after loan', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, deployer } = ctx;

      const liquidity = 50n * WAD;
      await weth.write.mint([deployer.account.address, liquidity]);
      await weth.write.approve([pool.address, liquidity]);
      await pool.write.supply([weth.address, liquidity, deployer.account.address, 0]);

      const receiver = await viem.deployContract('MockFlashLoanSimpleReceiver', [
        ctx.provider.address,
      ]);
      const poolBalanceBefore = await weth.read.balanceOf([aWeth.address]);

      // Flash loan 10 WETH (0% premium since FLASHLOAN_PREMIUM_TOTAL=0 at this point)
      const flashAmount = 10n * WAD;
      await pool.write.flashLoanSimple([receiver.address, weth.address, flashAmount, '0x', 0]);

      // Pool WETH balance must be fully restored (no premium since total=0)
      const poolBalanceAfter = await weth.read.balanceOf([aWeth.address]);
      assert.equal(
        poolBalanceAfter,
        poolBalanceBefore,
        'WETH pool balance must be unchanged after 0-premium flash loan'
      );
    });
  });

  // ── flashLoan (multi-asset) ──────────────────────────────────────────────────

  describe('flashLoan() — multi-asset', () => {
    it('multi-asset flash loan succeeds with correct repayment', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, deployer } = ctx;

      // Seed liquidity for both assets
      const wethLiquidity = 50n * WAD;
      const usdcLiquidity = 100_000n * 10n ** 6n;
      await weth.write.mint([deployer.account.address, wethLiquidity]);
      await usdc.write.mint([deployer.account.address, usdcLiquidity]);
      await weth.write.approve([pool.address, wethLiquidity]);
      await usdc.write.approve([pool.address, usdcLiquidity]);
      await pool.write.supply([weth.address, wethLiquidity, deployer.account.address, 0]);
      await pool.write.supply([usdc.address, usdcLiquidity, deployer.account.address, 0]);

      const receiver = await viem.deployContract('MockFlashLoanReceiver', [ctx.provider.address]);

      // Flash loan: 1 WETH + 1,000 USDC, mode=0 (no debt)
      await pool.write.flashLoan([
        receiver.address,
        [weth.address, usdc.address],
        [1n * WAD, 1_000n * 10n ** 6n],
        [0, 0], // no debt mode
        deployer.account.address,
        '0x',
        0,
      ]);
    });

    it('multi-asset flash loan fails when receiver fails', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, deployer } = ctx;

      const liquidity = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liquidity]);
      await usdc.write.approve([pool.address, liquidity]);
      await pool.write.supply([usdc.address, liquidity, deployer.account.address, 0]);

      const receiver = await viem.deployContract('MockFlashLoanReceiver', [ctx.provider.address]);
      await receiver.write.setFailExecutionTransfer([true]);

      await assert.rejects(
        pool.write.flashLoan([
          receiver.address,
          [usdc.address],
          [1_000n * 10n ** 6n],
          [0],
          deployer.account.address,
          '0x',
          0,
        ]),
        'flash loan with failing receiver must revert'
      );
    });

    it('single-asset via flashLoan(): pool balance restored after loan', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, aUsdc, deployer } = ctx;

      const liquidity = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liquidity]);
      await usdc.write.approve([pool.address, liquidity]);
      await pool.write.supply([usdc.address, liquidity, deployer.account.address, 0]);

      const receiver = await viem.deployContract('MockFlashLoanReceiver', [ctx.provider.address]);
      const poolBalanceBefore = await usdc.read.balanceOf([aUsdc.address]);

      const flashAmount = 5_000n * 10n ** 6n;
      await pool.write.flashLoan([
        receiver.address,
        [usdc.address],
        [flashAmount],
        [0],
        deployer.account.address,
        '0x',
        0,
      ]);

      // Pool USDC balance must be fully restored (0% premium)
      const poolBalanceAfter = await usdc.read.balanceOf([aUsdc.address]);
      assert.equal(
        poolBalanceAfter,
        poolBalanceBefore,
        'USDC pool balance must be unchanged after 0-premium flash loan'
      );
    });
  });

  // ── flashLoan borrow mode ────────────────────────────────────────────────────

  describe('flashLoan() — borrow mode (interestRateMode=2)', () => {
    it('flash loan with mode=2 creates variable debt for onBehalfOf user', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, varDebtUsdc, user1, deployer } = ctx;

      // Seed liquidity
      const usdcLiquidity = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, usdcLiquidity]);
      await usdc.write.approve([pool.address, usdcLiquidity]);
      await pool.write.supply([usdc.address, usdcLiquidity, deployer.account.address, 0]);

      // user1 supplies WETH collateral
      const wethAmount = 10n * WAD;
      await weth.write.mint([user1.account.address, wethAmount]);
      await weth.write.approve([pool.address, wethAmount], { account: user1.account });
      await pool.write.supply([weth.address, wethAmount, user1.account.address, 0], {
        account: user1.account,
      });

      // user1 approves receiver for credit delegation
      const flashAmount = 1_000n * 10n ** 6n;
      const receiver = await viem.deployContract('MockFlashLoanReceiver', [ctx.provider.address]);

      await varDebtUsdc.write.approveDelegation([receiver.address, flashAmount], {
        account: user1.account,
      });

      const debtBefore = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);

      // Flash loan with mode=2 → user1 ends up with debt, receiver keeps the funds
      await pool.write.flashLoan(
        [
          receiver.address,
          [usdc.address],
          [flashAmount],
          [Number(VARIABLE_RATE_MODE)], // mode=2: create variable debt
          user1.account.address, // onBehalfOf
          '0x',
          0,
        ],
        { account: user1.account }
      );

      const debtAfter = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);
      assert.ok(debtAfter > debtBefore, 'user1 must have debt after borrow-mode flash loan');
    });
  });

  // ── premium ──────────────────────────────────────────────────────────────────

  describe('Flash loan premium constants', () => {
    it('FLASHLOAN_PREMIUM_TOTAL starts at 0 (not configured in fixture)', async () => {
      const { pool } = await networkHelpers.loadFixture(deployMarket);
      // Pool.initialize sets _flashLoanPremiumTotal = 0 by default
      assert.equal(await pool.read.FLASHLOAN_PREMIUM_TOTAL(), 0n);
    });

    it('FLASHLOAN_PREMIUM_TO_PROTOCOL starts at 0 (not configured in fixture)', async () => {
      const { pool } = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await pool.read.FLASHLOAN_PREMIUM_TO_PROTOCOL(), 0n);
    });

    it('flash loan with non-zero premium: aToken balance grows by premium amount', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, usdc, aUsdc, deployer } = ctx;

      // Set 9 bps total premium, 4 bps protocol portion
      await poolConfigurator.write.updateFlashloanPremiumTotal([9n]);
      await poolConfigurator.write.updateFlashloanPremiumToProtocol([4n]);
      assert.equal(await pool.read.FLASHLOAN_PREMIUM_TOTAL(), 9n);

      // Seed liquidity
      const liquidity = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liquidity]);
      await usdc.write.approve([pool.address, liquidity]);
      await pool.write.supply([usdc.address, liquidity, deployer.account.address, 0]);

      const aUsdcBalBefore = await usdc.read.balanceOf([aUsdc.address]);

      // Flash loan — receiver mints premium to repay
      const receiver = await viem.deployContract('MockFlashLoanSimpleReceiver', [
        ctx.provider.address,
      ]);
      const flashAmount = 10_000n * 10n ** 6n;
      // expected premium = flashAmount * 9 / 10000 = 9000 (in USDC 6-decimal units)
      const expectedPremium = (flashAmount * 9n) / 10000n;

      await pool.write.flashLoanSimple([receiver.address, usdc.address, flashAmount, '0x', 0]);

      // aToken pool balance must grow by the premium (receiver repaid principal + premium)
      const aUsdcBalAfter = await usdc.read.balanceOf([aUsdc.address]);
      assert.ok(
        aUsdcBalAfter >= aUsdcBalBefore + expectedPremium,
        `pool must gain at least ${expectedPremium} USDC premium; got ${
          aUsdcBalAfter - aUsdcBalBefore
        }`
      );
    });

    it('updateFlashloanPremiumToProtocol updates correctly', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator } = ctx;

      await poolConfigurator.write.updateFlashloanPremiumTotal([9n]);
      await poolConfigurator.write.updateFlashloanPremiumToProtocol([4n]);
      assert.equal(await pool.read.FLASHLOAN_PREMIUM_TO_PROTOCOL(), 4n);
    });
  });

  // ── authorized flash borrower ────────────────────────────────────────────────

  describe('Flash borrower role (fee exemption)', () => {
    it('FLASH_BORROWER_ROLE can be granted and checked', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aclManager, user1 } = ctx;

      await aclManager.write.addFlashBorrower([user1.account.address]);
      assert.ok(await aclManager.read.isFlashBorrower([user1.account.address]));

      await aclManager.write.removeFlashBorrower([user1.account.address]);
      assert.ok(!(await aclManager.read.isFlashBorrower([user1.account.address])));
    });
  });
});
