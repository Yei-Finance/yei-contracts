/**
 * E2E — Advanced Operations
 *
 * Covers:
 *   - SupplyLogic lines 148-159: validateHFAndLtv during withdraw (user has borrow)
 *   - SupplyLogic lines 195-212: finalizeTransfer — HF validation + collateral disable
 *   - SupplyLogic line 267: setUseReserveAsCollateral no-op (same state)
 *   - BorrowLogic lines 213-215: repayWithATokens — sets amount to aToken balance
 *   - BorrowLogic lines 225-242: ceil payback for max variable repay
 *   - PoolLogic lines 84-109: mintToTreasury
 *   - ReserveLogic lines 243-276: _accrueToTreasury with reserve factor
 *   - GenericLogic lines 70-72: getUserAccountData for user with no positions (max HF)
 *   - GenericLogic line 141: zero-LTV collateral sets hasZeroLtvCollateral
 *   - AToken.sol: rescueTokens
 *   - Pool.sol lines 724-726: rescueTokens (onlyPoolAdmin)
 *   - Pool.sol deposit() deprecated alias
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE, ZERO_ADDR } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

describe('E2E: Advanced Operations', () => {
  // ── withdraw while borrowing ─────────────────────────────────────────────────

  describe('withdraw with active borrow (validateHFAndLtv)', () => {
    it('withdrawing collateral with active borrow runs HF validation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer } = ctx;

      await usdc.write.mint([deployer.account.address, 100_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 100_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 100_000n * 10n ** 6n, deployer.account.address, 0]);

      const wethAmt = 5n * WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow 5000 USDC (HF = 5*2000*0.85/5000 = 1.7)
      await pool.write.borrow(
        [usdc.address, 5_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Try to withdraw all WETH → HF would drop below 1 → should revert
      await assert.rejects(
        pool.write.withdraw([weth.address, wethAmt, user1.account.address], {
          account: user1.account,
        }),
        'withdrawing all collateral with active borrow must revert'
      );

      // Withdraw partial amount that keeps HF healthy (e.g., 1 WETH)
      await pool.write.withdraw([weth.address, WAD, user1.account.address], {
        account: user1.account,
      });
      // No revert = success
    });
  });

  // ── finalizeTransfer (aToken transfer) ───────────────────────────────────────

  describe('aToken transfer (finalizeTransfer)', () => {
    it('transferring aToken when sender has borrow triggers HF validation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, aWeth, user1, user2, deployer } = ctx;

      await usdc.write.mint([deployer.account.address, 100_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 100_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 100_000n * 10n ** 6n, deployer.account.address, 0]);

      const wethAmt = 5n * WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      await pool.write.borrow(
        [usdc.address, 5_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Try to transfer ALL aWETH to user2 → HF would drop to 0 → should revert
      const aWethBalance = await aWeth.read.balanceOf([user1.account.address]);
      await assert.rejects(
        aWeth.write.transfer([user2.account.address, aWethBalance], { account: user1.account }),
        'transferring all aWETH while borrowing must revert'
      );
    });

    it('transferring all aTokens with no active borrow disables collateral for sender', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1, user2 } = ctx;

      const wethAmt = 2n * WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      // user1 has no borrows — transfer all aWETH to user2
      // finalizeTransfer: balanceFromBefore == amount → setUsingAsCollateral(false) for user1
      const bal = await aWeth.read.balanceOf([user1.account.address]);
      await aWeth.write.transfer([user2.account.address, bal], { account: user1.account });

      // user1 should have 0 aWETH and 0 collateral
      const userData = await pool.read.getUserAccountData([user1.account.address]);
      assert.equal(userData[0], 0n, 'user1 must have no collateral after full aToken transfer');
    });
  });

  // ── setUseReserveAsCollateral no-op ──────────────────────────────────────────

  describe('setUseReserveAsCollateral no-op (line 267)', () => {
    it('calling setUseReserveAsCollateral(true) when already true is a no-op', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, user1 } = ctx;

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });
      await pool.write.supply([weth.address, WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // After supply, WETH is auto-enabled as collateral
      const dataBefore = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(dataBefore[0] > 0n, 'collateral must be enabled after supply');

      // Calling setUseReserveAsCollateral(true) when already true is a no-op (line 267 early return)
      await pool.write.setUserUseReserveAsCollateral([weth.address, true], {
        account: user1.account,
      });

      // Collateral state unchanged (no event emitted, no state change)
      const dataAfter = await pool.read.getUserAccountData([user1.account.address]);
      assert.equal(dataAfter[0], dataBefore[0], 'collateral must be unchanged after no-op call');
    });

    it('disabling then re-enabling collateral changes totalCollateralBase', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, user1 } = ctx;

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });
      await pool.write.supply([weth.address, WAD, user1.account.address, 0], {
        account: user1.account,
      });

      const dataEnabled = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(dataEnabled[0] > 0n, 'collateral enabled after supply');

      // Disable
      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });
      const dataDisabled = await pool.read.getUserAccountData([user1.account.address]);
      assert.equal(dataDisabled[0], 0n, 'collateral must be 0 after disabling');

      // Re-enable
      await pool.write.setUserUseReserveAsCollateral([weth.address, true], {
        account: user1.account,
      });
      const dataReenabled = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(dataReenabled[0] > 0n, 'collateral must be restored after re-enabling');
      assert.equal(dataReenabled[0], dataEnabled[0], 're-enabled collateral must match original');
    });
  });

  // ── repayWithATokens ─────────────────────────────────────────────────────────

  describe('repayWithATokens', () => {
    it('repayWithATokens uses aToken balance to repay variable debt', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, aUsdc, varDebtUsdc, user1, deployer } = ctx;

      // Seed USDC
      await usdc.write.mint([deployer.account.address, 100_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 100_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 100_000n * 10n ** 6n, deployer.account.address, 0]);

      // user1 supplies WETH (collateral)
      await weth.write.mint([user1.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 5n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // user1 borrows 1000 USDC
      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // user1 also supplies some USDC (gets aUSDC for repayWithATokens)
      await usdc.write.approve([pool.address, 500n * 10n ** 6n], { account: user1.account });
      await pool.write.supply([usdc.address, 500n * 10n ** 6n, user1.account.address, 0], {
        account: user1.account,
      });

      const scaledBefore = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);
      const aUsdcBefore = await aUsdc.read.balanceOf([user1.account.address]);

      // repayWithATokens: uses user1's aUSDC balance to repay USDC debt
      await pool.write.repayWithATokens([usdc.address, 200n * 10n ** 6n, VARIABLE_RATE_MODE], {
        account: user1.account,
      });

      const scaledAfter = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);
      const aUsdcAfter = await aUsdc.read.balanceOf([user1.account.address]);

      assert.ok(scaledAfter < scaledBefore, 'variable debt must decrease');
      assert.ok(aUsdcAfter < aUsdcBefore, 'aUSDC balance must decrease');
    });

    it('repayWithATokens with MAX_UINT256 uses actual aToken balance (line 213-215)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, aUsdc, varDebtUsdc, user1, deployer } = ctx;

      await usdc.write.mint([deployer.account.address, 100_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 100_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 100_000n * 10n ** 6n, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 5n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // user1 supplies 2000 aUSDC — more than the 1000 USDC debt — so MAX_UINT256 will be
      // capped to the aToken balance, not the debt amount (line 213-215).
      await usdc.write.mint([user1.account.address, 2_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 2_000n * 10n ** 6n], { account: user1.account });
      await pool.write.supply([usdc.address, 2_000n * 10n ** 6n, user1.account.address, 0], {
        account: user1.account,
      });

      const debtBefore = await varDebtUsdc.read.balanceOf([user1.account.address]);
      const aUsdcBefore = await aUsdc.read.balanceOf([user1.account.address]);
      assert.ok(debtBefore > 0n, 'user must have debt before repay');
      assert.ok(
        aUsdcBefore > debtBefore,
        'aUSDC balance must exceed debt to exercise the cap branch'
      );

      // MAX_UINT256 → amount is capped to aToken balance (line 213-215).
      // Since aUSDC balance (≈2000) > debt (≈1000), the debt is fully repaid.
      const maxUint = 2n ** 256n - 1n;
      await pool.write.repayWithATokens([usdc.address, maxUint, VARIABLE_RATE_MODE], {
        account: user1.account,
      });

      // Debt must be fully cleared (aToken balance > debt, so the whole debt is covered)
      const debtAfter = await varDebtUsdc.read.balanceOf([user1.account.address]);
      assert.equal(debtAfter, 0n, 'entire debt must be repaid when aToken balance exceeds debt');

      // aUSDC burned must be approximately the debt that was repaid, not MAX_UINT256
      const aUsdcAfter = await aUsdc.read.balanceOf([user1.account.address]);
      const aUsdcBurned = aUsdcBefore - aUsdcAfter;
      assert.ok(
        aUsdcBurned > 0n && aUsdcBurned < aUsdcBefore,
        'only the debt-equivalent aUSDC must be burned, not the entire balance'
      );
    });
  });

  // ── mintToTreasury ───────────────────────────────────────────────────────────

  describe('mintToTreasury', () => {
    it('accrues interest to treasury when reserve factor is set', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, aUsdc, user1, deployer, TREASURY } = ctx;

      // Set 10% reserve factor on USDC
      await poolConfigurator.write.setReserveFactor([usdc.address, 1000n]);

      await usdc.write.mint([deployer.account.address, 100_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 100_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 100_000n * 10n ** 6n, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow to generate interest
      await pool.write.borrow(
        [usdc.address, 10_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Advance 1 year to accumulate interest
      await networkHelpers.time.increase(365 * 24 * 3600);

      // Trigger state update by supplying (must be large enough; 1 wei rounds to 0 after 1yr accrual)
      await usdc.write.mint([deployer.account.address, 1_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 1_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 1_000n * 10n ** 6n, deployer.account.address, 0]);

      // Call mintToTreasury to mint accrued interest to treasury as aTokens
      const treasuryBefore = await aUsdc.read.balanceOf([TREASURY as `0x${string}`]);
      await pool.write.mintToTreasury([[usdc.address]]);
      const treasuryAfter = await aUsdc.read.balanceOf([TREASURY as `0x${string}`]);

      assert.ok(treasuryAfter > treasuryBefore, 'treasury must receive aUSDC after mintToTreasury');
    });
  });

  // ── getUserAccountData for user with no positions ────────────────────────────

  describe('getUserAccountData for empty user (GenericLogic line 70-72)', () => {
    it('fresh user with no positions returns max health factor', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, user2 } = ctx;

      // user2 has never interacted with the protocol
      const data = await pool.read.getUserAccountData([user2.account.address]);
      // Returns (0, 0, 0, 0, 0, type(uint256).max)
      assert.equal(data[0], 0n, 'totalCollateralBase must be 0');
      assert.equal(data[1], 0n, 'totalDebtBase must be 0');
      assert.equal(data[5], 2n ** 256n - 1n, 'healthFactor must be max for empty user');
    });
  });

  // ── zero LTV collateral (hasZeroLtvCollateral) ───────────────────────────────

  describe('zero-LTV collateral (GenericLogic line 141)', () => {
    it('asset with LTV=0 sets hasZeroLtvCollateral and prevents borrowing without other collateral', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Seed USDC
      await usdc.write.mint([deployer.account.address, 100_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 100_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 100_000n * 10n ** 6n, deployer.account.address, 0]);

      // Supply WETH first (LTV=8000 → auto-enables as collateral)
      await weth.write.mint([user1.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 5n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // NOW set LTV=0: user already has the collateral flag set from the prior supply
      // calculateUserAccountData → ltv==0 → hits GenericLogic line 141 (hasZeroLtvCollateral=true)
      await poolConfigurator.write.configureReserveAsCollateral([weth.address, 0n, 8500n, 10500n]);

      // With LTV=0, user cannot borrow (currentLtv = 0 → LTV_VALIDATION_FAILED)
      await assert.rejects(
        pool.write.borrow(
          [usdc.address, 100n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
          { account: user1.account }
        ),
        'borrow with zero-LTV collateral must revert'
      );
    });
  });

  // ── AToken rescueTokens ──────────────────────────────────────────────────────

  describe('AToken.rescueTokens', () => {
    it('pool admin can rescue stuck tokens from aToken contract', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, aWeth, deployer } = ctx;

      // Send some USDC directly to the aWETH contract (stuck tokens)
      const stuckAmt = 100n * 10n ** 6n;
      await usdc.write.mint([aWeth.address, stuckAmt]);

      const deployerUsdcBefore = await usdc.read.balanceOf([deployer.account.address]);

      // Pool admin rescues stuck USDC from aWETH contract
      await aWeth.write.rescueTokens([usdc.address, deployer.account.address, stuckAmt]);

      const deployerUsdcAfter = await usdc.read.balanceOf([deployer.account.address]);
      assert.equal(deployerUsdcAfter - deployerUsdcBefore, stuckAmt);
    });
  });

  // ── Pool.rescueTokens ────────────────────────────────────────────────────────

  describe('Pool.rescueTokens (onlyPoolAdmin)', () => {
    it('pool admin can rescue tokens sent directly to the pool contract', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, deployer } = ctx;

      // Send USDC directly to pool (stuck tokens)
      const stuckAmt = 50n * 10n ** 6n;
      await usdc.write.mint([pool.address, stuckAmt]);

      const before = await usdc.read.balanceOf([deployer.account.address]);
      await pool.write.rescueTokens([usdc.address, deployer.account.address, stuckAmt]);
      const after = await usdc.read.balanceOf([deployer.account.address]);

      assert.equal(after - before, stuckAmt);
    });

    it('non-admin cannot call rescueTokens on Pool', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, user1 } = ctx;

      await assert.rejects(
        pool.write.rescueTokens([usdc.address, user1.account.address, 1n], {
          account: user1.account,
        }),
        'non-admin must not rescue tokens'
      );
    });
  });

  // ── Pool.deposit (deprecated alias) ─────────────────────────────────────────

  describe('Pool.deposit (deprecated supply alias)', () => {
    it('deposit() works identically to supply()', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1 } = ctx;

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });

      // Call the deprecated deposit() function
      await pool.write.deposit([weth.address, WAD, user1.account.address, 0], {
        account: user1.account,
      });

      const aBalance = await aWeth.read.balanceOf([user1.account.address]);
      assert.ok(aBalance > 0n, 'deposit must mint aTokens');
    });
  });
});
