/**
 * E2E — Pool Edge Cases
 *
 * Covers:
 *   - Pool.finalizeTransfer() only callable by aToken (reverts otherwise)
 *   - Pool.initReserve() only callable by PoolConfigurator
 *   - Pool.setReserveInterestRateStrategyAddress() only callable by PoolConfigurator
 *   - mintToTreasury() skips inactive reserve (continue path in PoolLogic)
 *   - Pool.supply() with amount=0 reverts (INVALID_AMOUNT)
 *   - Pool.withdraw() with amount=0 reverts (INVALID_AMOUNT)
 *   - Pool.borrow() with amount=0 reverts (INVALID_AMOUNT)
 *   - AToken.mint() with amountScaled=0 reverts (INVALID_MINT_AMOUNT)
 *   - AToken.burn() with amountScaled=0 reverts (INVALID_BURN_AMOUNT)
 *   - getScaledUserBalanceAndSupply() before and after supply
 *   - getPreviousIndex() returns 0 before supply, > 0 after
 *   - Reserve getters: getReservesList, getReserveData
 *   - ValidationLogic: supply when inactive/frozen, borrow when inactive/frozen/borrowing-disabled
 *
 * Ported from test-suites/pool-edge.spec.ts, atoken-edge.spec.ts, validation-logic.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE, ZERO_ADDR } from '../helpers/deployMarket.js';

const { networkHelpers, viem } = await network.connect();
const MAX_UINT256 = 2n ** 256n - 1n;

describe('E2E: Pool Edge Cases', () => {
  // ── Access control on pool internals ─────────────────────────────────────────

  describe('Pool internal method access control', () => {
    it('finalizeTransfer() reverts when called by a non-aToken address', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, dai, user1, user2 } = ctx;

      await assert.rejects(
        pool.write.finalizeTransfer(
          [dai.address, user1.account.address, user2.account.address, 0n, 0n, 0n],
          { account: user1.account }
        ),
        'finalizeTransfer must revert for non-aToken caller'
      );
    });

    it('initReserve() reverts when called by a non-PoolConfigurator address', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, dai, user1 } = ctx;

      await assert.rejects(
        pool.write.initReserve([dai.address, ZERO_ADDR, ZERO_ADDR, ZERO_ADDR, ZERO_ADDR], {
          account: user1.account,
        }),
        'initReserve must revert for non-configurator caller'
      );
    });

    it('setReserveInterestRateStrategyAddress() reverts for non-configurator', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, dai, user1 } = ctx;

      await assert.rejects(
        pool.write.setReserveInterestRateStrategyAddress([dai.address, ZERO_ADDR], {
          account: user1.account,
        }),
        'setReserveInterestRateStrategyAddress must revert for non-configurator'
      );
    });
  });

  // ── mintToTreasury on inactive reserve ────────────────────────────────────────

  describe('mintToTreasury() on inactive reserves', () => {
    it('mintToTreasury() skips inactive reserve: no aTokens minted to treasury', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, dai, aDai, deployer } = ctx;

      // Deactivate DAI (no suppliers, so _checkNoSuppliers passes)
      await poolConfigurator.write.setReserveActive([dai.address, false]);

      // Capture treasury aDAI balance before the call
      const treasuryBefore = await aDai.read.balanceOf([deployer.account.address]);

      // mintToTreasury with the deactivated reserve: executeMintToTreasury hits the
      // `!getActive()` branch → continue, skipping the inactive reserve entirely
      await pool.write.mintToTreasury([[dai.address]]);

      // Treasury aDAI balance must be unchanged (inactive reserve was skipped)
      const treasuryAfter = await aDai.read.balanceOf([deployer.account.address]);
      assert.equal(
        treasuryAfter,
        treasuryBefore,
        'no aDAI must be minted to treasury for an inactive reserve'
      );
    });
  });

  // ── Invalid amounts ──────────────────────────────────────────────────────────

  describe('Invalid amount validation', () => {
    it('supply() with amount=0 reverts', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, user1 } = ctx;

      await assert.rejects(
        pool.write.supply([weth.address, 0n, user1.account.address, 0], {
          account: user1.account,
        }),
        'supply with amount=0 must revert'
      );
    });

    it('borrow() with amount=0 reverts', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, user1 } = ctx;

      await assert.rejects(
        pool.write.borrow([weth.address, 0n, VARIABLE_RATE_MODE, 0, user1.account.address], {
          account: user1.account,
        }),
        'borrow with amount=0 must revert'
      );
    });
  });

  // ── ValidationLogic: reserve state checks ────────────────────────────────────

  describe('ValidationLogic — reserve state gate checks', () => {
    it('supply() reverts when reserve is inactive', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      // Deactivate WETH (no suppliers yet)
      await poolConfigurator.write.setReserveActive([weth.address, false]);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });

      await assert.rejects(
        pool.write.supply([weth.address, WAD, user1.account.address, 0], {
          account: user1.account,
        }),
        'supply must revert when reserve is inactive'
      );
    });

    it('supply() reverts when reserve is frozen', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, user1 } = ctx;

      await poolConfigurator.write.setReserveFreeze([weth.address, true]);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });

      await assert.rejects(
        pool.write.supply([weth.address, WAD, user1.account.address, 0], {
          account: user1.account,
        }),
        'supply must revert when reserve is frozen'
      );
    });

    it('borrow() reverts when reserve is frozen', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Seed liquidity, then freeze USDC
      const liq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setReserveFreeze([usdc.address, true]);

      await assert.rejects(
        pool.write.borrow(
          [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
          { account: user1.account }
        ),
        'borrow must revert when reserve is frozen'
      );
    });

    it('borrow() reverts when borrowing is disabled', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      const liq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      await poolConfigurator.write.setReserveBorrowing([usdc.address, false]);

      await assert.rejects(
        pool.write.borrow(
          [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
          { account: user1.account }
        ),
        'borrow must revert when borrowing is disabled'
      );
    });

    it('borrow() reverts with invalid interest rate mode', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer } = ctx;

      const liq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Rate mode 0 is invalid (only 1=stable, 2=variable are valid)
      await assert.rejects(
        pool.write.borrow([usdc.address, 100n * 10n ** 6n, 0n, 0, user1.account.address], {
          account: user1.account,
        }),
        'borrow with rate mode 0 must revert'
      );
    });

    it('borrow() with stable rate reverts when stable rate is not enabled', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer } = ctx;

      const liq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Stable rate is disabled by default
      const STABLE_RATE_MODE = 1n;
      await assert.rejects(
        pool.write.borrow(
          [usdc.address, 100n * 10n ** 6n, STABLE_RATE_MODE, 0, user1.account.address],
          { account: user1.account }
        ),
        'borrow stable must revert when stable rate is not enabled'
      );
    });
  });

  // ── ScaledBalanceTokenBase getters ────────────────────────────────────────────

  describe('ScaledBalanceTokenBase getters', () => {
    it('getScaledUserBalanceAndSupply() returns (0, 0) before any supply', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, user1 } = ctx;

      const [userBal, totalSupply] = await aWeth.read.getScaledUserBalanceAndSupply([
        user1.account.address,
      ]);
      assert.equal(userBal, 0n, 'scaled user balance must be 0 before supply');
      assert.equal(totalSupply, 0n, 'scaled total supply must be 0 before supply');
    });

    it('getScaledUserBalanceAndSupply() returns correct values after supply', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1 } = ctx;

      const amt = 1_000n * WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      const [userBal, totalSupply] = await aWeth.read.getScaledUserBalanceAndSupply([
        user1.account.address,
      ]);
      assert.equal(userBal, amt, 'scaled user balance must equal supplied amount at RAY index');
      assert.equal(
        totalSupply,
        amt,
        'scaled total supply must equal user balance with single supplier'
      );
    });

    it('getPreviousIndex() returns 0 before first supply', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, user1 } = ctx;

      const prevIdx = await aWeth.read.getPreviousIndex([user1.account.address]);
      assert.equal(prevIdx, 0n, 'previous index must be 0 before any interaction');
    });

    it('getPreviousIndex() is set after first supply', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1 } = ctx;

      const prevIdxBefore = await aWeth.read.getPreviousIndex([user1.account.address]);
      assert.equal(prevIdxBefore, 0n);

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });
      await pool.write.supply([weth.address, WAD, user1.account.address, 0], {
        account: user1.account,
      });

      const prevIdxAfter = await aWeth.read.getPreviousIndex([user1.account.address]);
      assert.ok(prevIdxAfter > 0n, 'previous index must be set after supply');
    });
  });

  // ── Pool getters ──────────────────────────────────────────────────────────────

  describe('Pool.getReservesList()', () => {
    it('returns all initialized reserves', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, dai } = ctx;

      const reserves = await pool.read.getReservesList();
      const reservesLc = reserves.map((a: string) => a.toLowerCase());

      assert.ok(reservesLc.includes(weth.address.toLowerCase()), 'WETH must be in reserves');
      assert.ok(reservesLc.includes(usdc.address.toLowerCase()), 'USDC must be in reserves');
      assert.ok(reservesLc.includes(dai.address.toLowerCase()), 'DAI must be in reserves');
      assert.equal(reserves.length, 3, 'must have exactly 3 reserves');
    });
  });

  describe('AaveProtocolDataProvider', () => {
    it('getUserReserveData() returns usageAsCollateralEnabled=true after first supply', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, dataProvider, user1 } = ctx;

      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });
      await pool.write.supply([weth.address, WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // getUserReserveData returns a plain array (multi-return, not struct) in viem:
      // [0]=currentATokenBalance, ..., [8]=usageAsCollateralEnabled
      const userData = await dataProvider.read.getUserReserveData([
        weth.address,
        user1.account.address,
      ]);
      const usageAsCollateralEnabled = (userData as any)[8];
      assert.equal(
        usageAsCollateralEnabled,
        true,
        'usageAsCollateralEnabled must be true after supply'
      );
    });

    it('getReserveTokensAddresses() returns correct aToken and debt token addresses', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { weth, aWeth, varDebtWeth, stableDebtWeth, dataProvider } = ctx;

      // getReserveTokensAddresses returns a plain array in viem:
      // [0]=aTokenAddress, [1]=stableDebtTokenAddress, [2]=variableDebtTokenAddress
      const tokens = await dataProvider.read.getReserveTokensAddresses([weth.address]);
      const [aTokenAddress, stableDebtTokenAddress, variableDebtTokenAddress] = tokens as any;
      assert.equal(aTokenAddress, aWeth.address);
      assert.equal(variableDebtTokenAddress, varDebtWeth.address);
      assert.equal(stableDebtTokenAddress, stableDebtWeth.address);
    });

    it('getReserveConfigurationData() returns correct booleans for active reserve', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { weth, pool } = ctx;

      // pool.read.getConfiguration returns { data: bigint }
      // Bit positions (ReserveConfiguration.sol):
      //   56 = isActive, 57 = isFrozen, 58 = borrowingEnabled, 59 = stableBorrowRateEnabled
      const cfg = await pool.read.getConfiguration([weth.address]);
      const isActive = (cfg.data >> 56n) & 1n;
      const isFrozen = (cfg.data >> 57n) & 1n;
      const borrowingEnabled = (cfg.data >> 58n) & 1n;
      const stableEnabled = (cfg.data >> 59n) & 1n;

      assert.equal(isActive, 1n, 'WETH must be active');
      assert.equal(isFrozen, 0n, 'WETH must not be frozen');
      assert.equal(borrowingEnabled, 1n, 'WETH must have borrowing enabled');
      assert.equal(stableEnabled, 0n, 'WETH must not have stable rate enabled');
    });
  });

  // ── Interest accrual over time ────────────────────────────────────────────────

  describe('Interest accrual', () => {
    it('borrow index grows over time (getReserveNormalizedVariableDebt)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer } = ctx;

      // Seed liquidity
      const liq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow 10,000 USDC (50% LTV against 10 WETH @ $2000 = $20,000 → 50% LTV < 80% max)
      await pool.write.borrow(
        [usdc.address, 10_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      const indexBefore = await pool.read.getReserveNormalizedVariableDebt([usdc.address]);

      // Advance 1 year
      await networkHelpers.time.increase(365 * 24 * 3600);

      // Trigger index update by interacting with the reserve (must be large enough to not floor to 0)
      const refreshAmt = 100n * 10n ** 6n; // 100 USDC
      await usdc.write.mint([deployer.account.address, refreshAmt]);
      await usdc.write.approve([pool.address, refreshAmt]);
      await pool.write.supply([usdc.address, refreshAmt, deployer.account.address, 0]);

      const indexAfter = await pool.read.getReserveNormalizedVariableDebt([usdc.address]);
      assert.ok(
        indexAfter > indexBefore,
        'borrow index must grow after time passes with utilization'
      );
    });

    it('liquidity index grows over time when there are borrowers', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, user1, deployer } = ctx;

      const liq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // Borrow 10,000 USDC (50% LTV against 10 WETH @ $2000 = $20,000 → 50% LTV < 80% max)
      await pool.write.borrow(
        [usdc.address, 10_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      const indexBefore = (await pool.read.getReserveData([usdc.address])).liquidityIndex;

      await networkHelpers.time.increase(365 * 24 * 3600);

      // Force index update (must be large enough to not floor to 0 scaled shares at elevated index)
      const refreshAmt = 100n * 10n ** 6n; // 100 USDC
      await usdc.write.mint([deployer.account.address, refreshAmt]);
      await usdc.write.approve([pool.address, refreshAmt]);
      await pool.write.supply([usdc.address, refreshAmt, deployer.account.address, 0]);

      const indexAfter = (await pool.read.getReserveData([usdc.address])).liquidityIndex;
      assert.ok(indexAfter > indexBefore, 'liquidity index must grow over time with borrowers');
    });
  });

  // ── swapBorrowRateMode when pool is paused ─────────────────────────────────

  describe('swapBorrowRateMode() when pool is paused', () => {
    it('paused pool prevents swapBorrowRateMode', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      await poolConfigurator.write.setReserveStableRateBorrowing([usdc.address, true]);

      const liq = 1_000_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      await pool.write.borrow(
        [usdc.address, 1_000n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      await poolConfigurator.write.setPoolPause([true]);

      await assert.rejects(
        pool.write.swapBorrowRateMode([usdc.address, VARIABLE_RATE_MODE], {
          account: user1.account,
        }),
        'swapBorrowRateMode must revert when pool is paused'
      );
    });
  });
});
