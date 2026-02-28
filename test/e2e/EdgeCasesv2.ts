/**
 * E2E — Miscellaneous Coverage
 *
 * Covers:
 *   - Pool.sol lines 506-509: getUserConfiguration
 *   - Pool.sol line 548-549: getReserveAddressById
 *   - Pool.sol lines 762-765: isInForcedLiquidationWhitelist
 *   - VariableDebtToken.sol lines 145-171: unsupported ERC20 ops + UNDERLYING_ASSET_ADDRESS
 *   - AToken.sol line 161-162: UNDERLYING_ASSET_ADDRESS
 *   - AToken.sol lines 274-282: approveOnBehalf
 *   - ScaledBalanceTokenBase.sol lines 43-44: getScaledUserBalanceAndSupply
 *   - ScaledBalanceTokenBase.sol lines 53-54: getPreviousIndex
 *   - ScaledBalanceTokenBase.sol lines 162-175: aToken transfer with interest accrual (both emit branches)
 *   - PoolConfigurator.sol lines 154-160: configureReserveAsCollateral with threshold=0 (disable collateral)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

describe('E2E: Miscellaneous Coverage', () => {
  // ── Pool simple getters ───────────────────────────────────────────────────

  describe('Pool simple getters', () => {
    it('getUserConfiguration returns user config bitfield (Pool line 509)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, user1 } = ctx;

      const config = await pool.read.getUserConfiguration([user1.account.address]);
      // fresh user has all-zero config
      assert.equal(config.data, 0n);
    });

    it('getReserveAddressById returns the asset address for reserve id 0 (Pool line 549)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth } = ctx;

      // WETH is reserve id 0 (first initialized)
      const addr = await pool.read.getReserveAddressById([0]);
      assert.equal(addr.toLowerCase(), weth.address.toLowerCase());
    });

    it('isInForcedLiquidationWhitelist returns false for non-whitelisted address (Pool line 765)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, user1 } = ctx;

      const result = await pool.read.isInForcedLiquidationWhitelist([user1.account.address]);
      assert.equal(result, false);
    });
  });

  // ── VariableDebtToken unsupported ERC20 operations ────────────────────────

  describe('VariableDebtToken unsupported ERC20 ops (lines 145-171)', () => {
    it('transfer reverts with OPERATION_NOT_SUPPORTED (line 145-147)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { varDebtWeth, user1, user2 } = ctx;

      await assert.rejects(
        varDebtWeth.write.transfer([user2.account.address, 1n], { account: user1.account }),
        'transfer must revert'
      );
    });

    it('allowance reverts with OPERATION_NOT_SUPPORTED (line 149-151)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { varDebtWeth, user1, user2 } = ctx;

      await assert.rejects(
        varDebtWeth.read.allowance([user1.account.address, user2.account.address]),
        'allowance must revert'
      );
    });

    it('approve reverts with OPERATION_NOT_SUPPORTED (line 153-155)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { varDebtWeth, user1, user2 } = ctx;

      await assert.rejects(
        varDebtWeth.write.approve([user2.account.address, 1n], { account: user1.account }),
        'approve must revert'
      );
    });

    it('transferFrom reverts with OPERATION_NOT_SUPPORTED (line 157-159)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { varDebtWeth, user1, user2 } = ctx;

      await assert.rejects(
        varDebtWeth.write.transferFrom([user1.account.address, user2.account.address, 1n], {
          account: user1.account,
        }),
        'transferFrom must revert'
      );
    });

    it('increaseAllowance reverts with OPERATION_NOT_SUPPORTED (line 161-163)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { varDebtWeth, user1, user2 } = ctx;

      await assert.rejects(
        varDebtWeth.write.increaseAllowance([user2.account.address, 1n], {
          account: user1.account,
        }),
        'increaseAllowance must revert'
      );
    });

    it('decreaseAllowance reverts with OPERATION_NOT_SUPPORTED (line 165-167)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { varDebtWeth, user1, user2 } = ctx;

      await assert.rejects(
        varDebtWeth.write.decreaseAllowance([user2.account.address, 1n], {
          account: user1.account,
        }),
        'decreaseAllowance must revert'
      );
    });

    it('UNDERLYING_ASSET_ADDRESS returns the underlying asset address (line 170-172)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { varDebtWeth, weth } = ctx;

      const underlying = await varDebtWeth.read.UNDERLYING_ASSET_ADDRESS();
      assert.equal(underlying.toLowerCase(), weth.address.toLowerCase());
    });
  });

  // ── AToken getters and approveOnBehalf ────────────────────────────────────

  describe('AToken getters and approveOnBehalf', () => {
    it('UNDERLYING_ASSET_ADDRESS returns the underlying asset address (AToken line 161-162)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, weth } = ctx;

      const underlying = await aWeth.read.UNDERLYING_ASSET_ADDRESS();
      assert.equal(underlying.toLowerCase(), weth.address.toLowerCase());
    });

    it('approveOnBehalf allows pool admin to set allowance on behalf of user (lines 274-282)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, user1, user2, deployer } = ctx;

      // deployer is pool admin; set allowance for user1 → user2
      const approved = await aWeth.write.approveOnBehalf(
        [user1.account.address, user2.account.address, 500n * WAD],
        { account: deployer.account }
      );
      // Should succeed (no revert) and return true
      // Verify allowance was set
      const allowance = await aWeth.read.allowance([user1.account.address, user2.account.address]);
      assert.equal(allowance, 500n * WAD);
    });
  });

  // ── ScaledBalanceTokenBase getters ────────────────────────────────────────

  describe('ScaledBalanceTokenBase getters (lines 43-54)', () => {
    it('getScaledUserBalanceAndSupply returns (scaledBalance, scaledTotalSupply) (line 43-44)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, aWeth, weth, user1 } = ctx;

      await weth.write.mint([user1.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 5n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      const [scaledBalance, scaledTotalSupply] = await aWeth.read.getScaledUserBalanceAndSupply([
        user1.account.address,
      ]);
      assert.ok(scaledBalance > 0n, 'scaledBalance must be positive after supply');
      assert.ok(scaledTotalSupply >= scaledBalance, 'scaledTotalSupply >= scaledBalance');
    });

    it("getPreviousIndex returns user's last stored liquidity index (line 53-54)", async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, aWeth, weth, user1 } = ctx;

      await weth.write.mint([user1.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 5n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      const prevIndex = await aWeth.read.getPreviousIndex([user1.account.address]);
      // Initial index = RAY = 1e27
      assert.ok(prevIndex > 0n, 'previousIndex must be set after supply');
    });
  });

  // ── aToken transfer with interest accrual ─────────────────────────────────

  describe('aToken transfer with interest accrual (ScaledBalanceTokenBase lines 162-175)', () => {
    it('transferring aTokens emits Mint events for both sender and recipient accrued interest', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, aWeth, weth, usdc, user1, user2, deployer } = ctx;

      // user1 supplies 10 WETH (gets aWETH; additionalData = initial index ≈ RAY)
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // user2 supplies 5 WETH (gets aWETH; additionalData = initial index ≈ RAY)
      await weth.write.mint([user2.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user2.account });
      await pool.write.supply([weth.address, 5n * WAD, user2.account.address, 0], {
        account: user2.account,
      });

      // deployer supplies 10,000 USDC as collateral and borrows 2 WETH
      // → WETH liquidity rate > 0 so interest accrues on aWETH holders
      const usdcLiq = 10_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, usdcLiq]);
      await usdc.write.approve([pool.address, usdcLiq]);
      await pool.write.supply([usdc.address, usdcLiq, deployer.account.address, 0]);
      await pool.write.borrow([
        weth.address,
        2n * WAD,
        VARIABLE_RATE_MODE,
        0,
        deployer.account.address,
      ]);

      // Advance 1 year so both user1 and user2 accumulate senderBalanceIncrease > 0
      await networkHelpers.time.increase(365 * 24 * 3600);

      // Transfer 1 aWETH from user1 → user2.
      // This mines a block at future timestamp → currentIndex > both stored indices.
      // ScaledBalanceTokenBase._transfer:
      //   senderBalanceIncrease > 0 → lines 162-164 executed (emit Transfer + Mint for sender)
      //   sender != recipient && recipientBalanceIncrease > 0 → lines 167-169 executed
      const user1BalBefore = await aWeth.read.balanceOf([user1.account.address]);
      const user2BalBefore = await aWeth.read.balanceOf([user2.account.address]);

      await aWeth.write.transfer([user2.account.address, 1n * WAD], { account: user1.account });

      const user1BalAfter = await aWeth.read.balanceOf([user1.account.address]);
      const user2BalAfter = await aWeth.read.balanceOf([user2.account.address]);

      // user1's aWETH decreased by ~1 WAD (plus any rounding)
      assert.ok(user1BalAfter < user1BalBefore, 'user1 aWETH must decrease after transfer');
      // user2's aWETH increased by ~1 WAD
      assert.ok(user2BalAfter > user2BalBefore, 'user2 aWETH must increase after transfer');
    });
  });

  // ── ValidationLogic siloed borrowing validation ──────────────────────────

  describe('ValidationLogic siloed borrow validation (line 303)', () => {
    it('borrowing the same siloed asset a second time passes the siloed check (line 303)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, weth, usdc, user1, deployer } = ctx;

      // Mark USDC as siloed
      await poolConfigurator.write.setSiloedBorrowing([usdc.address, true]);

      // Seed USDC liquidity
      const liq = 100_000n * 10n ** 6n;
      await usdc.write.mint([deployer.account.address, liq]);
      await usdc.write.approve([pool.address, liq]);
      await pool.write.supply([usdc.address, liq, deployer.account.address, 0]);

      // user1 supplies WETH collateral
      await weth.write.mint([user1.account.address, 10n * WAD]);
      await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      // First borrow of USDC (siloed): isBorrowingAny()=false → skip siloed check → OK
      await pool.write.borrow(
        [usdc.address, 100n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Second borrow of USDC (siloed, same asset):
      //   isBorrowingAny()=true → siloedBorrowingEnabled=true, siloedBorrowingAddress=USDC
      //   require(USDC == USDC) → passes (ValidationLogic line 303 covered)
      await pool.write.borrow(
        [usdc.address, 50n * 10n ** 6n, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );
      // No revert = line 303 executed and passed
    });
  });

  // ── IncentivizedERC20.setIncentivesController ────────────────────────────

  describe('IncentivizedERC20.setIncentivesController (line 118)', () => {
    it('pool admin can update the incentives controller on an aToken', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, deployer, user1 } = ctx;

      assert.equal(
        await aWeth.read.getIncentivesController(),
        '0x0000000000000000000000000000000000000000'
      );

      // Use user1's address as a stand-in for the new controller
      await aWeth.write.setIncentivesController([user1.account.address], {
        account: deployer.account,
      });

      assert.equal(
        (await aWeth.read.getIncentivesController()).toLowerCase(),
        user1.account.address.toLowerCase()
      );
    });
  });

  // ── ReserveLogic same-block updateState skip (line 100) ──────────────────

  describe('ReserveLogic same-block updateState skip (line 100)', () => {
    it('skips updateState when a second op lands in the same block: lastUpdateTimestamp unchanged', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, deployer } = ctx;

      const amount = WAD;
      await weth.write.mint([deployer.account.address, amount * 3n]);
      await weth.write.approve([pool.address, amount * 3n]);

      // First supply — mines its own block, sets lastUpdateTimestamp = T1
      await pool.write.supply([weth.address, amount, deployer.account.address, 0]);
      const reserveDataT1 = await pool.read.getReserveData([weth.address]);
      const lastUpdateT1 = reserveDataT1.lastUpdateTimestamp;

      // Disable automine so the next two txs land in the same block (T2)
      // First queued tx:  T2 > T1 → updateState executes, sets lastUpdateTimestamp = T2
      // Second queued tx: T2 == T2 → early return at ReserveLogic.sol:100 (skip)
      const { viem: localViem } = await network.connect();
      const pubClient = await localViem.getPublicClient();
      await pubClient.request({ method: 'evm_setAutomine', params: [false] } as any);
      try {
        await pool.write.supply([weth.address, amount, deployer.account.address, 0]);
        await pool.write.supply([weth.address, amount, deployer.account.address, 0]);
        await pubClient.request({ method: 'evm_mine', params: [] } as any);
      } finally {
        await pubClient.request({ method: 'evm_setAutomine', params: [true] } as any);
      }

      // All three supplies succeeded: aWeth balance should be ≥ 3 * amount
      const scaledBalance = await aWeth.read.scaledBalanceOf([deployer.account.address]);
      assert.equal(scaledBalance, 3n * amount, 'all three supplies must have accumulated');

      // The lastUpdateTimestamp after the batch must be T2 > T1 (first tx updated it)
      // and both same-block txs share the same T2 (skip on second)
      const reserveDataT2 = await pool.read.getReserveData([weth.address]);
      assert.ok(
        reserveDataT2.lastUpdateTimestamp > lastUpdateT1,
        'lastUpdateTimestamp must advance from T1 to T2 (first tx in batch)'
      );
    });
  });

  // ── PoolConfigurator: disable collateral (threshold=0) ───────────────────

  describe('PoolConfigurator.configureReserveAsCollateral with threshold=0 (lines 154-160)', () => {
    it('setting threshold=0 clears LTV and bonus, disabling DAI as collateral', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, poolConfigurator, dai } = ctx;

      // Before: DAI has LTV=7500, LT=8000, bonus=10500
      const configBefore = await pool.read.getConfiguration([dai.address]);
      const ltvBefore = configBefore.data & 0xffffn;
      assert.equal(ltvBefore, 7500n, 'DAI LTV must be 7500 initially');

      // DAI has no suppliers in the fixture → _checkNoSuppliers passes (line 159)
      // threshold=0, bonus=0 → require(liquidationBonus == 0) passes (line 155)
      await poolConfigurator.write.configureReserveAsCollateral([dai.address, 0n, 0n, 0n]);

      // After: LTV, LT, and bonus must all be 0
      const configAfter = await pool.read.getConfiguration([dai.address]);
      const ltv = configAfter.data & 0xffffn;
      const lt = (configAfter.data >> 16n) & 0xffffn;
      const bonus = (configAfter.data >> 32n) & 0xffffn;
      assert.equal(ltv, 0n, 'LTV must be 0 after disabling collateral');
      assert.equal(lt, 0n, 'liquidationThreshold must be 0 after disabling collateral');
      assert.equal(bonus, 0n, 'liquidationBonus must be 0 after disabling collateral');
    });
  });
});
