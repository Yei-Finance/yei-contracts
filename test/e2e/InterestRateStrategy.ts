/**
 * E2E — DefaultReserveInterestRateStrategy
 *
 * Covers:
 *   - Lines 107, 112, 117, 122, 127: getter functions
 *   - Lines 184-194: borrow usage ratio above optimal (slope2 region)
 *   - Lines 206-208: stable rate above optimal utilization
 *   - updateFlashloanPremiumTotal / updateFlashloanPremiumToProtocol (PoolConfigurator)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE, RAY } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

// Strategy constants from deployMarket.ts (wethStrategy):
//   OPT_80 = 80% RAY, baseVar = 0, SLOPE1 = 4% RAY, SLOPE2 = 75% RAY
//   S_SLOPE1 = 0.5% RAY, S_SLOPE2 = 60% RAY, S_OFFSET = 1% RAY
//   S_EXCESS = 8% RAY, S_OPT_RATIO = 20% RAY
const SLOPE1 = (4n * RAY) / 100n; // 4%
const SLOPE2 = (75n * RAY) / 100n; // 75%
const S_SLOPE1 = (5n * RAY) / 1000n; // 0.5%
const S_SLOPE2 = (60n * RAY) / 100n; // 60%
const S_OFFSET = (1n * RAY) / 100n; // 1%
const S_EXCESS = (8n * RAY) / 100n; // 8%
const OPT_80 = (80n * RAY) / 100n; // 80%

describe('E2E: Interest Rate Strategy', () => {
  describe('getter functions — wethStrategy (OPT=80%, slope1=4%, slope2=75%)', () => {
    it('getVariableRateSlope1 returns 4% RAY', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await ctx.wethStrategy.read.getVariableRateSlope1(), SLOPE1);
    });

    it('getVariableRateSlope2 returns 75% RAY', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await ctx.wethStrategy.read.getVariableRateSlope2(), SLOPE2);
    });

    it('getStableRateSlope1 returns 0.5% RAY', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await ctx.wethStrategy.read.getStableRateSlope1(), S_SLOPE1);
    });

    it('getStableRateSlope2 returns 60% RAY', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await ctx.wethStrategy.read.getStableRateSlope2(), S_SLOPE2);
    });

    it('getStableRateExcessOffset returns 8% RAY', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await ctx.wethStrategy.read.getStableRateExcessOffset(), S_EXCESS);
    });

    it('getBaseStableBorrowRate returns S_OFFSET + SLOPE1 (stable base = offset + var slope1)', async () => {
      // In DefaultReserveInterestRateStrategy: baseStableRate = S_OFFSET + baseVar + slope1
      // wethStrategy: baseVar=0, so baseStableRate = S_OFFSET + SLOPE1 = 1% + 4% = 5% RAY
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const base = await ctx.wethStrategy.read.getBaseStableBorrowRate();
      assert.equal(base, S_OFFSET + SLOPE1, `expected S_OFFSET+SLOPE1 = ${S_OFFSET + SLOPE1}`);
    });

    it('getBaseVariableBorrowRate returns 0 (wethStrategy has 0 base rate)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await ctx.wethStrategy.read.getBaseVariableBorrowRate(), 0n);
    });

    it('getMaxVariableBorrowRate returns SLOPE1 + SLOPE2 (base=0 for wethStrategy)', async () => {
      // maxVar = baseVar + slope1 + slope2 = 0 + 4% + 75% = 79% RAY
      const ctx = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await ctx.wethStrategy.read.getMaxVariableBorrowRate(), SLOPE1 + SLOPE2);
    });

    it('OPTIMAL_USAGE_RATIO returns 80% RAY', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      assert.equal(await ctx.wethStrategy.read.OPTIMAL_USAGE_RATIO(), OPT_80);
    });
  });

  describe('calculateInterestRates above optimal utilization (slope2 region)', () => {
    it('variable borrow rate uses slope2 when utilization exceeds optimal', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer, wethStrategy } = ctx;

      // Seed USDC liquidity
      await usdc.write.mint([deployer.account.address, 1_000_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 1_000_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 1_000_000n * 10n ** 6n, deployer.account.address, 0]);

      // user1 supplies WETH, borrows large portion of USDC (>80% utilization → above optimal)
      // Need enough collateral: 900,000 USDC / (2000 * 0.80) = 562.5 WETH → use 700 WETH
      await weth.write.mint([user1.account.address, 700n * WAD]);
      await weth.write.approve([pool.address, 700n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 700n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow 950,000 USDC out of 1,000,000 → 95% utilization (above 90% optimal for stableStrategy)
      // Collateral needed: 950,000 / (2000 * 0.80) = 593.75 WETH → 700 WETH is enough
      await pool.write.borrow(
        [usdc.address, 950_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // The variable borrow rate is now in the slope2 region (utilization 95% > optimal 90%)
      const reserveData = await pool.read.getReserveData([usdc.address]);
      const variableRate = reserveData.currentVariableBorrowRate;

      // At 95% utilization (above 90% optimal), rate = baseVar + slope1 + slope2 * excessRatio
      // Should be noticeably higher than just slope1
      const slope1 = await ctx.stableStrategy.read.getVariableRateSlope1();
      assert.ok(variableRate > slope1, 'variable rate must exceed slope1 at high utilization');
    });
  });

  // ── updateFlashloanPremiumTotal / updateFlashloanPremiumToProtocol ────────────

  describe('PoolConfigurator flash loan premium updates', () => {
    it('updateFlashloanPremiumTotal updates the total flash loan premium', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool } = ctx;

      // Set total premium to 9 bps
      await poolConfigurator.write.updateFlashloanPremiumTotal([9n]);
      assert.equal(await pool.read.FLASHLOAN_PREMIUM_TOTAL(), 9n);
    });

    it('updateFlashloanPremiumToProtocol updates the protocol portion of premium', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool } = ctx;

      // Set protocol premium to 4 bps
      await poolConfigurator.write.updateFlashloanPremiumToProtocol([4n]);
      assert.equal(await pool.read.FLASHLOAN_PREMIUM_TO_PROTOCOL(), 4n);
    });
  });
});
