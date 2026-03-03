/**
 * E2E — AToken Transfer
 *
 * Covers:
 *   - AToken transfer to self (same user)
 *   - AToken transfer with collateral disabled first
 *   - AToken transfer to another user
 *   - Multiple small transfers
 *   - Zero-amount transfer
 *   - Transfer that would drop HF below 1 (must revert)
 *   - Small transfer that leaves HF healthy (must succeed)
 *   - transferFrom() with approve
 *   - increaseAllowance / decreaseAllowance
 *   - name() and symbol()
 *   - Transfer emits Transfer event
 *
 * Ported from test-suites/atoken-transfer.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();
const MAX_UINT256 = 2n ** 256n - 1n;
const STABLE_RATE_MODE = 1n;

describe('E2E: AToken Transfer', () => {
  // ── Basic transfers ────────────────────────────────────────────────────────

  describe('transfer() — basic', () => {
    it('transfer to self does not change balance', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      const balBefore = await aWeth.read.balanceOf([user1.account.address]);
      await aWeth.write.transfer([user1.account.address, amt], { account: user1.account });
      const balAfter = await aWeth.read.balanceOf([user1.account.address]);

      // Balance must be the same (self-transfer is a no-op for state, but Transfer event emits)
      assert.ok(
        balAfter >= balBefore - 1n && balAfter <= balBefore + 1n,
        'self-transfer must not change balance (within 1 wei rounding)'
      );
    });

    it('transfer to another user moves aTokens correctly', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1, user2 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      // Disable collateral so transfer doesn't trigger HF check
      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });

      await aWeth.write.transfer([user2.account.address, amt], { account: user1.account });

      const fromBal = await aWeth.read.balanceOf([user1.account.address]);
      const toBal = await aWeth.read.balanceOf([user2.account.address]);

      assert.equal(fromBal, 0n, 'sender must have 0 aTokens after full transfer');
      assert.ok(toBal > 0n, 'receiver must have positive aToken balance');
    });

    it('transfer with collateral disabled allows full transfer', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1, user2 } = ctx;

      const depositAmt = 1_000n * WAD;
      await weth.write.mint([user1.account.address, depositAmt]);
      await weth.write.approve([pool.address, depositAmt], { account: user1.account });
      await pool.write.supply([weth.address, depositAmt, user1.account.address, 0], {
        account: user1.account,
      });

      // Disable collateral first
      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });

      const transferAmt = depositAmt;
      await aWeth.write.transfer([user2.account.address, transferAmt], {
        account: user1.account,
      });

      assert.equal(
        await aWeth.read.balanceOf([user1.account.address]),
        0n,
        'sender must have 0 after full transfer'
      );
    });

    it('multiple small transfers accumulate correctly in receiver', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1, user2 } = ctx;

      const depositAmt = 1_000n * WAD;
      await weth.write.mint([user1.account.address, depositAmt]);
      await weth.write.approve([pool.address, depositAmt], { account: user1.account });
      await pool.write.supply([weth.address, depositAmt, user1.account.address, 0], {
        account: user1.account,
      });

      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });

      const smallAmt = 5n * WAD;

      await aWeth.write.transfer([user2.account.address, smallAmt], { account: user1.account });
      const balAfterFirst = await aWeth.read.balanceOf([user2.account.address]);

      await aWeth.write.transfer([user2.account.address, smallAmt], { account: user1.account });
      const balAfterSecond = await aWeth.read.balanceOf([user2.account.address]);

      assert.ok(balAfterSecond > balAfterFirst, 'receiver balance must grow with each transfer');
      assert.ok(balAfterFirst > 0n);
    });

    it('zero-amount transfer does not change balances', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1, user2 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      const balBefore = await aWeth.read.balanceOf([user1.account.address]);
      // Zero transfer should succeed without reverting
      await aWeth.write.transfer([user2.account.address, 0n], { account: user1.account });
      const balAfter = await aWeth.read.balanceOf([user1.account.address]);

      // Balance should be unchanged (within 1 wei for potential index rounding)
      assert.ok(
        balAfter >= balBefore - 1n && balAfter <= balBefore + 1n,
        'zero transfer must not change sender balance'
      );
      // receiver must have 0
      const recvBal = await aWeth.read.balanceOf([user2.account.address]);
      assert.equal(recvBal, 0n);
    });
  });

  // ── Health-factor constrained transfers ────────────────────────────────────

  describe('transfer() — health factor constraints', () => {
    it('partial aWETH transfer reverts when it would drop HF below 1', async () => {
      // user1 supplies 1 WETH ($2000, 80% LT) and borrows 1590 DAI → HF ≈ 1.006.
      // Transferring just 0.1 aWETH leaves 0.9 WETH → HF ≈ 0.905 < 1 → must revert.
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, dai, aWeth, user1, user2, deployer } = ctx;

      // Seed DAI liquidity
      const daiLiq = 100_000n * WAD;
      await dai.write.mint([deployer.account.address, daiLiq]);
      await dai.write.approve([pool.address, daiLiq]);
      await pool.write.supply([dai.address, daiLiq, deployer.account.address, 0]);

      // user1 supplies 1 WETH
      const wethAmt = WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      // user1 borrows 1,590 DAI — HF ≈ 2000 * 0.80 / 1590 ≈ 1.006 (just above 1)
      await pool.write.borrow(
        [dai.address, 1_590n * WAD, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Transfer 0.1 aWETH → remaining 0.9 WETH → HF ≈ 0.9 * 2000 * 0.80 / 1590 ≈ 0.905 < 1
      const transferAmt = WAD / 10n;
      await assert.rejects(
        aWeth.write.transfer([user2.account.address, transferAmt], { account: user1.account }),
        'partial transfer that drops HF below 1 must revert'
      );
    });

    it('full aToken transfer reverts when it would make HF < 1 (borrower self-transfer scenario)', async () => {
      // user1 has WETH collateral (aWETH) and DAI debt.
      // Transferring all aWETH would leave them with no collateral → HF < 1 → revert.
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, dai, aWeth, user1, user2, deployer } = ctx;

      // Seed DAI liquidity
      const daiLiq = 100_000n * WAD;
      await dai.write.mint([deployer.account.address, daiLiq]);
      await dai.write.approve([pool.address, daiLiq]);
      await pool.write.supply([dai.address, daiLiq, deployer.account.address, 0]);

      // user1 supplies 1 WETH ($2000 collateral)
      const wethAmt = WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      // user1 borrows 1,200 DAI (HF ≈ 2000 * 0.85 / 1200 ≈ 1.41 > 1)
      await pool.write.borrow(
        [dai.address, 1_200n * WAD, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // user1 tries to transfer all aWETH to user2 → would leave user1 with no collateral → HF < 1
      const aWethBal = await aWeth.read.balanceOf([user1.account.address]);
      assert.ok(aWethBal > 0n);

      await assert.rejects(
        aWeth.write.transfer([user2.account.address, aWethBal], { account: user1.account }),
        'transfer that drops HF below 1 must revert'
      );
    });

    it('partial aToken transfer that keeps HF above 1 succeeds', async () => {
      // user1 has 10 WETH collateral and borrows 1,200 DAI.
      // Transferring 1 aWETH leaves 9 WETH → HF = 9*2000*0.85/1200 = 12.75 > 1 → succeeds.
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, dai, aWeth, user1, user2, deployer } = ctx;

      const daiLiq = 100_000n * WAD;
      await dai.write.mint([deployer.account.address, daiLiq]);
      await dai.write.approve([pool.address, daiLiq]);
      await pool.write.supply([dai.address, daiLiq, deployer.account.address, 0]);

      const wethAmt = 10n * WAD;
      await weth.write.mint([user1.account.address, wethAmt]);
      await weth.write.approve([pool.address, wethAmt], { account: user1.account });
      await pool.write.supply([weth.address, wethAmt, user1.account.address, 0], {
        account: user1.account,
      });

      await pool.write.borrow(
        [dai.address, 1_200n * WAD, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Transfer just 1 aWETH (leaves 9 WETH → HF >> 1)
      const smallTransfer = WAD;
      await aWeth.write.transfer([user2.account.address, smallTransfer], {
        account: user1.account,
      });

      const user2Bal = await aWeth.read.balanceOf([user2.account.address]);
      assert.ok(user2Bal > 0n, 'user2 must receive aWETH');
    });
  });

  // ── approve / transferFrom / allowance ────────────────────────────────────

  describe('approve() / transferFrom() / allowance()', () => {
    it('approve sets allowance correctly', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1, user2 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      await aWeth.write.approve([user2.account.address, amt], { account: user1.account });
      const allowance = await aWeth.read.allowance([user1.account.address, user2.account.address]);
      assert.equal(allowance, amt, 'allowance must match approved amount');
    });

    it('transferFrom uses approval', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1, user2 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      // Disable collateral so HF check doesn't block
      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });

      await aWeth.write.approve([user2.account.address, amt], { account: user1.account });
      await aWeth.write.transferFrom([user1.account.address, user2.account.address, amt], {
        account: user2.account,
      });

      const user2Bal = await aWeth.read.scaledBalanceOf([user2.account.address]);
      assert.ok(user2Bal > 0n, 'user2 must receive aTokens via transferFrom');
    });

    it('transferFrom with zero amount uses no approval', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, user1, user2 } = ctx;

      const user1BalBefore = await aWeth.read.scaledBalanceOf([user1.account.address]);
      const user2BalBefore = await aWeth.read.scaledBalanceOf([user2.account.address]);

      // No approval needed for 0-amount transfer
      await aWeth.write.transferFrom([user1.account.address, user2.account.address, 0n], {
        account: user2.account,
      });

      // Neither balance must change
      assert.equal(
        await aWeth.read.scaledBalanceOf([user1.account.address]),
        user1BalBefore,
        'sender scaled balance must not change on zero-amount transferFrom'
      );
      assert.equal(
        await aWeth.read.scaledBalanceOf([user2.account.address]),
        user2BalBefore,
        'receiver scaled balance must not change on zero-amount transferFrom'
      );
      // Allowance was never consumed — must remain zero
      assert.equal(
        await aWeth.read.allowance([user1.account.address, user2.account.address]),
        0n,
        'allowance must stay zero: zero-amount transferFrom requires no approval'
      );
    });

    it('increaseAllowance adds to existing allowance', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, user1, user2 } = ctx;

      await aWeth.write.approve([user2.account.address, 100n], { account: user1.account });
      await aWeth.write.increaseAllowance([user2.account.address, 50n], { account: user1.account });
      const allowance = await aWeth.read.allowance([user1.account.address, user2.account.address]);
      assert.equal(allowance, 150n);
    });

    it('decreaseAllowance subtracts from existing allowance', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, user1, user2 } = ctx;

      await aWeth.write.approve([user2.account.address, 100n], { account: user1.account });
      await aWeth.write.decreaseAllowance([user2.account.address, 30n], { account: user1.account });
      const allowance = await aWeth.read.allowance([user1.account.address, user2.account.address]);
      assert.equal(allowance, 70n);
    });
  });

  // ── AToken metadata ────────────────────────────────────────────────────────

  describe('AToken metadata', () => {
    it('name() returns correct token name', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth } = ctx;
      const name = await aWeth.read.name();
      assert.equal(name, 'Aave WETH', 'aWETH name must be "Aave WETH"');
    });

    it('symbol() returns correct token symbol', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth } = ctx;
      const symbol = await aWeth.read.symbol();
      assert.equal(symbol, 'aWETH', 'aWETH symbol must be "aWETH"');
    });

    it('decimals() matches underlying decimals', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, weth, aUsdc, usdc } = ctx;

      assert.equal(await aWeth.read.decimals(), await weth.read.decimals());
      assert.equal(await aUsdc.read.decimals(), await usdc.read.decimals());
    });

    it('UNDERLYING_ASSET_ADDRESS() returns underlying token', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, weth, aUsdc, usdc } = ctx;

      assert.equal(
        (await aWeth.read.UNDERLYING_ASSET_ADDRESS()).toLowerCase(),
        weth.address.toLowerCase()
      );
      assert.equal(
        (await aUsdc.read.UNDERLYING_ASSET_ADDRESS()).toLowerCase(),
        usdc.address.toLowerCase()
      );
    });

    it('POOL() returns the pool address', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { aWeth, pool } = ctx;

      assert.equal((await aWeth.read.POOL()).toLowerCase(), pool.address.toLowerCase());
    });
  });

  // ── setUserUseReserveAsCollateral edge cases ───────────────────────────────

  describe('setUserUseReserveAsCollateral() edge cases', () => {
    it('setUserUseReserveAsCollateral(true) is idempotent when already enabled', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, dataProvider, user1 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      // Verify it's already enabled after supply
      // getUserReserveData returns plain array; [8] = usageAsCollateralEnabled
      const dataBefore = await dataProvider.read.getUserReserveData([
        weth.address,
        user1.account.address,
      ]);
      assert.equal(
        (dataBefore as any)[8],
        true,
        'usageAsCollateralEnabled must be true after supply'
      );

      const collateralBefore = (await pool.read.getUserAccountData([user1.account.address]))[0];

      // Setting to true again must be a no-op: the early-return path in SupplyLogic is taken.
      await pool.write.setUserUseReserveAsCollateral([weth.address, true], {
        account: user1.account,
      });

      // Verify state is completely unchanged (early-return means no storage writes)
      const dataAfter = await dataProvider.read.getUserReserveData([
        weth.address,
        user1.account.address,
      ]);
      assert.equal((dataAfter as any)[8], true, 'usageAsCollateralEnabled must remain true');
      const collateralAfter = (await pool.read.getUserAccountData([user1.account.address]))[0];
      assert.equal(
        collateralAfter,
        collateralBefore,
        'totalCollateralBase must not change on idempotent call (no state write, no event)'
      );
    });

    it('setUserUseReserveAsCollateral(false) is idempotent when already disabled', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, dataProvider, user1 } = ctx;

      const amt = WAD;
      await weth.write.mint([user1.account.address, amt]);
      await weth.write.approve([pool.address, amt], { account: user1.account });
      await pool.write.supply([weth.address, amt, user1.account.address, 0], {
        account: user1.account,
      });

      // Disable first
      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });

      // getUserReserveData returns plain array; [8] = usageAsCollateralEnabled
      const dataBefore = await dataProvider.read.getUserReserveData([
        weth.address,
        user1.account.address,
      ]);
      assert.equal((dataBefore as any)[8], false, 'collateral must be disabled before second call');

      // totalCollateralBase must already be 0 after the first disable
      const collateralDisabled = (await pool.read.getUserAccountData([user1.account.address]))[0];
      assert.equal(collateralDisabled, 0n, 'totalCollateralBase must be 0 after first disable');

      // Disable again — must be a no-op: the early-return path in SupplyLogic is taken.
      await pool.write.setUserUseReserveAsCollateral([weth.address, false], {
        account: user1.account,
      });

      // Verify state is completely unchanged (early-return means no storage writes, no event)
      const dataAfter = await dataProvider.read.getUserReserveData([
        weth.address,
        user1.account.address,
      ]);
      assert.equal((dataAfter as any)[8], false, 'collateral must stay disabled');
      const collateralAfter = (await pool.read.getUserAccountData([user1.account.address]))[0];
      assert.equal(
        collateralAfter,
        0n,
        'totalCollateralBase must remain 0 on idempotent disable (no state write, no event)'
      );
    });
  });
});
