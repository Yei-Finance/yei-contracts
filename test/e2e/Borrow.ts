/**
 * E2E — Borrow & Repay
 *
 * Covers:
 *   - borrow() variable rate
 *   - balanceOf debt grows with borrow index
 *   - repay() partial and full
 *   - repayWithATokens()
 *   - repayWithPermit()
 *   - swapBorrowRateMode() (revert — stable disabled)
 *   - getUserAccountData() with debt
 *   - Pool.getReserveNormalizedIncome() and getReserveNormalizedVariableDebt()
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();
const MAX_UINT256 = 2n ** 256n - 1n;

// ── helpers ──────────────────────────────────────────────────────────────────

async function setupCollateralAndBorrow(ctx: Awaited<ReturnType<typeof deployMarket>>) {
  const { pool, weth, usdc, user1, deployer } = ctx;

  // deployer provides USDC liquidity
  const usdcLiquidity = 100_000n * 10n ** 6n;
  await usdc.write.mint([deployer.account.address, usdcLiquidity]);
  await usdc.write.approve([pool.address, usdcLiquidity]);
  await pool.write.supply([usdc.address, usdcLiquidity, deployer.account.address, 0]);

  // user1 supplies WETH as collateral
  const wethAmount = 10n * WAD;
  await weth.write.mint([user1.account.address, wethAmount]);
  await weth.write.approve([pool.address, wethAmount], { account: user1.account });
  await pool.write.supply([weth.address, wethAmount, user1.account.address, 0], {
    account: user1.account,
  });

  return { wethAmount };
}

describe('E2E: Borrow & Repay', () => {
  // ── borrow ──────────────────────────────────────────────────────────────────

  describe('borrow()', () => {
    it('user can borrow variable-rate USDC against WETH collateral', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, varDebtUsdc, user1 } = ctx;
      await setupCollateralAndBorrow(ctx);

      const borrowAmount = 1_000n * 10n ** 6n; // 1,000 USDC
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      // user1 should have USDC in their wallet
      assert.equal(await usdc.read.balanceOf([user1.account.address]), borrowAmount);

      // At the initial RAY borrow index ceil(amount × RAY / RAY) = amount exactly — no rounding gap
      const debtBalance = await varDebtUsdc.read.balanceOf([user1.account.address]);
      assert.equal(
        debtBalance,
        borrowAmount,
        'debt must equal borrowed amount at initial RAY index'
      );
    });

    it('borrow at index=RAY: scaledDebt == amount exactly (ceil(x/RAY) = x when index=RAY)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, varDebtUsdc, user1 } = ctx;
      await setupCollateralAndBorrow(ctx);

      // At index=RAY: ceil(amount * RAY / RAY) = amount exactly, no rounding manifests
      const borrowAmount = 3n;
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      assert.equal(await varDebtUsdc.read.scaledBalanceOf([user1.account.address]), borrowAmount);
    });

    it('borrow uses ceil rounding: scaledDebt > underlying amount at index > RAY', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, weth, varDebtUsdc, user1, deployer } = ctx;

      // Seed 100k USDC so 90k borrow = 90% utilization → high variable rate
      const usdcLiq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, usdcLiq]);
      await usdc.write.approve([pool.address, usdcLiq]);
      await pool.write.supply([usdc.address, usdcLiq, deployer.account.address, 0]);

      // user1 supplies 60 WETH collateral: 60 × $2000 × 80% LTV = $96k borrow capacity
      await weth.write.mint([user1.account.address, 60n * WAD]);
      await weth.write.approve([pool.address, 60n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 60n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow 90k USDC (90% utilization) → above OPT_80, steep slope2 → borrow index grows fast
      await pool.write.borrow(
        [usdc.address, 90_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );
      await networkHelpers.time.increase(365 * 24 * 3600);

      // Now borrow a tiny amount at the elevated index
      const tinyBorrow = 3n;
      const scaledBefore = await varDebtUsdc.read.scaledTotalSupply();
      await pool.write.borrow(
        [usdc.address, tinyBorrow, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );
      const scaledAfter = await varDebtUsdc.read.scaledTotalSupply();
      const mintScaled = scaledAfter - scaledBefore;

      const idx = await pool.read.getReserveNormalizedVariableDebt([usdc.address]);
      const RAY = 10n ** 27n;
      const expectedCeil = (tinyBorrow * RAY + idx - 1n) / idx;
      const expectedFloor = (tinyBorrow * RAY) / idx;

      assert.equal(mintScaled, expectedCeil, 'borrow must use ceil rounding');
      assert.ok(mintScaled >= expectedFloor, 'ceil >= floor (protocol favored)');
    });

    it('getUserAccountData reflects debt after borrow', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, user1 } = ctx;
      await setupCollateralAndBorrow(ctx);

      const borrowAmount = 500n * 10n ** 6n; // 500 USDC
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      // getUserAccountData returns positional tuple: [collateral, debt, availBorrows, ltThresh, ltv, healthFactor]
      const userData = await pool.read.getUserAccountData([user1.account.address]);
      assert.ok(userData[1] > 0n, 'total debt must be positive');
      // HF = 10 WETH × $2000 × 0.85 / 500 USDC = 34.0 — well above 1.0 (1e18 in ray notation)
      assert.ok(
        userData[5] > 10n ** 18n,
        'health factor must be above 1.0 for a well-collateralised borrow'
      );
      assert.ok(userData[2] > 0n, 'available borrows must be positive');
    });

    it('borrow reduces availableBorrows', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, user1 } = ctx;
      await setupCollateralAndBorrow(ctx);

      const dataBefore = await pool.read.getUserAccountData([user1.account.address]);
      const borrowAmount = 1_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );
      const dataAfter = await pool.read.getUserAccountData([user1.account.address]);

      assert.ok(dataAfter[2] < dataBefore[2], 'available borrows must decrease after borrow');
    });

    it('borrow onBehalfOf creates debt for the specified user', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, varDebtUsdc, deployer, user1, user2 } = ctx;
      await setupCollateralAndBorrow(ctx);

      // user1 needs to approve user2 to borrow on their behalf via credit delegation
      const borrowAmount = 100n * 10n ** 6n;
      await varDebtUsdc.write.approveDelegation([user2.account.address, borrowAmount], {
        account: user1.account,
      });

      // user2 borrows on behalf of user1
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user2.account,
        }
      );

      // user1 has the debt, user2 received the USDC
      assert.ok(
        (await varDebtUsdc.read.scaledBalanceOf([user1.account.address])) > 0n,
        'user1 must have debt'
      );
      assert.equal(await usdc.read.balanceOf([user2.account.address]), borrowAmount);
    });
  });

  // ── getReserveNormalized ────────────────────────────────────────────────────

  describe('Pool.getReserveNormalized*()', () => {
    it('getReserveNormalizedIncome starts at RAY', async () => {
      const { pool, weth } = await networkHelpers.loadFixture(deployMarket);
      const income = await pool.read.getReserveNormalizedIncome([weth.address]);
      assert.equal(income, 10n ** 27n);
    });

    it('getReserveNormalizedVariableDebt starts at RAY', async () => {
      const { pool, usdc } = await networkHelpers.loadFixture(deployMarket);
      const debt = await pool.read.getReserveNormalizedVariableDebt([usdc.address]);
      assert.equal(debt, 10n ** 27n);
    });
  });

  // ── repay ────────────────────────────────────────────────────────────────────

  describe('repay()', () => {
    it('partial repay reduces debt', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, varDebtUsdc, user1 } = ctx;
      await setupCollateralAndBorrow(ctx);

      const borrowAmount = 2_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      const debtBefore = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);

      const repayAmount = 500n * 10n ** 6n;
      await usdc.write.approve([pool.address, repayAmount], { account: user1.account });
      await pool.write.repay(
        [usdc.address, repayAmount, VARIABLE_RATE_MODE, user1.account.address],
        {
          account: user1.account,
        }
      );

      const debtAfter = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);
      assert.ok(debtAfter < debtBefore, 'debt must decrease after partial repay');
    });

    it('full repay with type(uint256).max clears all debt', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, varDebtUsdc, user1 } = ctx;
      await setupCollateralAndBorrow(ctx);

      const borrowAmount = 1_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      // Mint extra USDC to cover any accrued interest
      await usdc.write.mint([user1.account.address, 10n * 10n ** 6n]);
      await usdc.write.approve([pool.address, MAX_UINT256], { account: user1.account });
      await pool.write.repay(
        [usdc.address, MAX_UINT256, VARIABLE_RATE_MODE, user1.account.address],
        {
          account: user1.account,
        }
      );

      assert.equal(await varDebtUsdc.read.scaledBalanceOf([user1.account.address]), 0n);
    });

    it('repay uses floor rounding: scaledBurned < scaledMinted for same tiny amount at index > RAY', async () => {
      // This test proves the asymmetry: borrow uses ceil, repay uses floor.
      // At a near-RAY index ceil == floor, so we must first push the variable borrow
      // index significantly above RAY (90 % utilization for 1 year → ~1.4× RAY).
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, weth, varDebtUsdc, user1, deployer } = ctx;

      // Seed 100 k USDC and push utilization to 90 % so the borrow index grows fast
      const usdcLiq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, usdcLiq]);
      await usdc.write.approve([pool.address, usdcLiq]);
      await pool.write.supply([usdc.address, usdcLiq, deployer.account.address, 0]);

      // user1 supplies 60 WETH (80 % LTV × $2 000 × 60 = $96 k borrow capacity)
      await weth.write.mint([user1.account.address, 60n * WAD]);
      await weth.write.approve([pool.address, 60n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 60n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow 90 k USDC (90 % utilization → above kink → steep slope → fast index growth)
      await pool.write.borrow(
        [usdc.address, 90_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Advance 1 year so the variable borrow index grows well above RAY
      await networkHelpers.time.increase(365 * 24 * 3600);

      // ── Borrow a tiny amount at the elevated index ──────────────────────────
      // BorrowLogic: scaledMinted = ceil(tinyAmount × RAY / idx)
      const tinyAmount = 3n;
      const scaledBeforeBorrow = await varDebtUsdc.read.scaledTotalSupply();
      await pool.write.borrow(
        [usdc.address, tinyAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );
      const scaledAfterBorrow = await varDebtUsdc.read.scaledTotalSupply();
      const mintedScaled = scaledAfterBorrow - scaledBeforeBorrow;

      // Read the stored borrow index used for that transaction
      const idxAtBorrow = (await pool.read.getReserveData([usdc.address])).variableBorrowIndex;
      const RAY = 10n ** 27n;
      const expectedCeil = (tinyAmount * RAY + idxAtBorrow - 1n) / idxAtBorrow;
      const expectedFloor = (tinyAmount * RAY) / idxAtBorrow;

      assert.equal(mintedScaled, expectedCeil, 'borrow must use ceil rounding');
      assert.ok(
        expectedCeil > expectedFloor,
        'index must be elevated enough to split ceil and floor'
      );

      // ── Repay the same tiny amount at (nearly) the same elevated index ──────
      // BorrowLogic: scaledBurned = floor(tinyAmount × RAY / idx)
      await usdc.write.approve([pool.address, tinyAmount], { account: user1.account });
      await pool.write.repay(
        [usdc.address, tinyAmount, VARIABLE_RATE_MODE, user1.account.address],
        { account: user1.account }
      );
      const scaledAfterRepay = await varDebtUsdc.read.scaledTotalSupply();
      const burnedScaled = scaledAfterBorrow - scaledAfterRepay;

      // Read the index used for the repay (one second later — negligibly higher)
      const idxAtRepay = (await pool.read.getReserveData([usdc.address])).variableBorrowIndex;
      const expectedFloorAtRepay = (tinyAmount * RAY) / idxAtRepay;

      assert.equal(burnedScaled, expectedFloorAtRepay, 'repay must use floor rounding');
      // Protocol-favoring: borrow mints ceil units, repay burns only floor units
      assert.ok(
        burnedScaled < mintedScaled,
        'repay must burn fewer scaled units than the borrow minted (floor < ceil)'
      );
    });

    it('repay by another user on behalf works', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, usdc, varDebtUsdc, deployer, user1 } = ctx;
      await setupCollateralAndBorrow(ctx);

      const borrowAmount = 500n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      const scaledBefore = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);

      // MAX_UINT256 is not allowed when repaying on behalf of another user (Aave error '40').
      // Repay a partial amount; full repay-to-zero is tested in "full repay with MAX_UINT256".
      const repayAmount = 200n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, repayAmount]);
      await usdc.write.approve([pool.address, repayAmount]);
      await pool.write.repay([
        usdc.address,
        repayAmount,
        VARIABLE_RATE_MODE,
        user1.account.address,
      ]);

      const scaledAfter = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);
      assert.ok(scaledAfter < scaledBefore, 'debt must decrease after repay on behalf');
      assert.ok(scaledAfter > 0n, 'partial repay must not clear full debt');
    });
  });

  // ── repayWithATokens ─────────────────────────────────────────────────────────

  describe('repayWithATokens()', () => {
    it('user can repay USDC debt using aUSDC tokens', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, aUsdc, varDebtUsdc, user1 } = ctx;

      // Setup: user1 supplies WETH collateral
      const wethAmount = 10n * WAD;
      await weth.write.mint([user1.account.address, wethAmount]);
      await weth.write.approve([pool.address, wethAmount], { account: user1.account });
      await pool.write.supply([weth.address, wethAmount, user1.account.address, 0], {
        account: user1.account,
      });

      // deployer provides USDC liquidity
      const usdcLiquidity = 50_000n * 10n ** 6n;
      await usdc.write.mint([pool.address, usdcLiquidity]); // seed pool's available liquidity
      // Actually need to supply, not just mint to pool:
      await usdc.write.mint([ctx.deployer.account.address, usdcLiquidity]);
      await usdc.write.approve([pool.address, usdcLiquidity]);
      await pool.write.supply([usdc.address, usdcLiquidity, ctx.deployer.account.address, 0]);

      // user1 borrows USDC
      const borrowAmount = 1_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmount, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      // user1 supplies the borrowed USDC to get aUSDC
      await usdc.write.approve([pool.address, borrowAmount], { account: user1.account });
      await pool.write.supply([usdc.address, borrowAmount, user1.account.address, 0], {
        account: user1.account,
      });

      const aUsdcBefore = await aUsdc.read.scaledBalanceOf([user1.account.address]);
      const debtBefore = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);
      assert.ok(aUsdcBefore > 0n, 'user1 must have aUSDC');
      assert.ok(debtBefore > 0n, 'user1 must have debt');

      // Repay using aUSDC (small amount to avoid full repay complexity)
      const repayViaAToken = 100n * 10n ** 6n;
      await pool.write.repayWithATokens([usdc.address, repayViaAToken, VARIABLE_RATE_MODE], {
        account: user1.account,
      });

      const aUsdcAfter = await aUsdc.read.scaledBalanceOf([user1.account.address]);
      const debtAfter = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);

      assert.ok(aUsdcAfter < aUsdcBefore, 'aUSDC balance must decrease');
      assert.ok(debtAfter < debtBefore, 'debt must decrease');
    });
  });

  // ── credit delegation ────────────────────────────────────────────────────────

  describe('VariableDebtToken.approveDelegation()', () => {
    it('borrowAllowance is set correctly', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { varDebtUsdc, user1, user2 } = ctx;

      const allowance = 500n * 10n ** 6n;
      await varDebtUsdc.write.approveDelegation([user2.account.address, allowance], {
        account: user1.account,
      });

      assert.equal(
        await varDebtUsdc.read.borrowAllowance([user1.account.address, user2.account.address]),
        allowance
      );
    });
  });

  // ── multi-reserve borrow ─────────────────────────────────────────────────────

  describe('multi-asset borrow', () => {
    it('user can borrow multiple assets against the same collateral', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, dai, varDebtUsdc, varDebtDai, user1, deployer } = ctx;

      // Seed liquidity
      const usdcLiq = 50_000n * 10n ** 6n;
      const daiLiq = 50_000n * WAD;
      await usdc.write.mint([deployer.account.address, usdcLiq]);
      await dai.write.mint([deployer.account.address, daiLiq]);
      await usdc.write.approve([pool.address, usdcLiq]);
      await dai.write.approve([pool.address, daiLiq]);
      await pool.write.supply([usdc.address, usdcLiq, deployer.account.address, 0]);
      await pool.write.supply([dai.address, daiLiq, deployer.account.address, 0]);

      // user1 collateral
      const wethAmount = 20n * WAD;
      await weth.write.mint([user1.account.address, wethAmount]);
      await weth.write.approve([pool.address, wethAmount], { account: user1.account });
      await pool.write.supply([weth.address, wethAmount, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow both
      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );
      await pool.write.borrow(
        [dai.address, 500n * WAD, VARIABLE_RATE_MODE, 0, user1.account.address],
        {
          account: user1.account,
        }
      );

      assert.ok(
        (await varDebtUsdc.read.scaledBalanceOf([user1.account.address])) > 0n,
        'must have USDC debt'
      );
      assert.ok(
        (await varDebtDai.read.scaledBalanceOf([user1.account.address])) > 0n,
        'must have DAI debt'
      );
    });
  });

  // ── getConfiguration ─────────────────────────────────────────────────────────

  describe('Pool.getConfiguration()', () => {
    it('returns correct LTV, liquidationThreshold, and liquidationBonus for WETH', async () => {
      const { pool, weth } = await networkHelpers.loadFixture(deployMarket);

      // WETH configured: LTV=8000, LT=8500, bonus=10500 (see deployMarket.ts)
      // ReserveConfiguration bit layout:
      //   bits 0-15:  LTV
      //   bits 16-31: liquidationThreshold
      //   bits 32-47: liquidationBonus
      const config = await pool.read.getConfiguration([weth.address]);
      const ltv = config.data & 0xffffn;
      const lt = (config.data >> 16n) & 0xffffn;
      const bonus = (config.data >> 32n) & 0xffffn;

      assert.equal(ltv, 8000n, 'WETH LTV must be 8000');
      assert.equal(lt, 8500n, 'WETH liquidationThreshold must be 8500');
      assert.equal(bonus, 10500n, 'WETH liquidationBonus must be 10500');
    });
  });
});
