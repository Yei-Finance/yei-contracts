/**
 * Unit — ReserveConfiguration
 *
 * Tests the ReserveConfiguration library through MockReserveConfiguration.
 * Covers all bitfield getter/setter pairs and boundary validation.
 *
 * Ported from test-suites/reserve-configuration.spec.ts
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';

const { viem, networkHelpers } = await network.connect();

// ── Constants matching ReserveConfiguration.sol limits ───────────────────────

const MAX_VALID_LTV = 65535n;
const MAX_VALID_LIQUIDATION_THRESHOLD = 65535n;
const MAX_VALID_DECIMALS = 255n;
const MAX_VALID_EMODE_CATEGORY = 255n;
const MAX_VALID_RESERVE_FACTOR = 65535n;
const MAX_VALID_LIQUIDATION_PROTOCOL_FEE = 65535n;

const LTV = 8000n;
const LB = 500n;
const RESERVE_FACTOR = 1000n;
const DECIMALS = 18n;
const BORROW_CAP = 100n;
const SUPPLY_CAP = 200n;
const UNBACKED_MINT_CAP = 300n;
const EMODE_CATEGORY = 1n;

describe('ReserveConfiguration', () => {
  // Each test gets a fresh MockReserveConfiguration to avoid state leakage
  async function deploy() {
    const mock = await viem.deployContract('MockReserveConfiguration');
    return mock;
  }

  // ── getParams / getCaps helpers ───────────────────────────────────────────────

  async function assertParams(
    mock: any,
    expected: [bigint, bigint, bigint, bigint, bigint, bigint]
  ) {
    const params = await mock.read.getParams();
    assert.deepEqual(params, expected);
  }

  async function assertCaps(mock: any, expected: [bigint, bigint]) {
    const caps = await mock.read.getCaps();
    assert.deepEqual(caps, expected);
  }

  // ── getLtv / setLtv ──────────────────────────────────────────────────────────

  describe('getLtv() / setLtv()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getLtv(), 0n);
    });

    it('set and read back LTV', async () => {
      const mock = await deploy();
      await mock.write.setLtv([LTV]);
      assert.equal(await mock.read.getLtv(), LTV);
      // LTV is the 1st param (index 0)
      await assertParams(mock, [LTV, 0n, 0n, 0n, 0n, 0n]);
    });

    it('clear LTV back to 0', async () => {
      const mock = await deploy();
      await mock.write.setLtv([LTV]);
      await mock.write.setLtv([0n]);
      assert.equal(await mock.read.getLtv(), 0n);
      await assertParams(mock, [0n, 0n, 0n, 0n, 0n, 0n]);
    });

    it('set to MAX_VALID_LTV succeeds', async () => {
      const mock = await deploy();
      await mock.write.setLtv([MAX_VALID_LTV]);
      assert.equal(await mock.read.getLtv(), MAX_VALID_LTV);
    });

    it('set to MAX_VALID_LTV + 1 reverts (INVALID_LTV)', async () => {
      const mock = await deploy();
      await assert.rejects(
        mock.write.setLtv([MAX_VALID_LTV + 1n]),
        'LTV > MAX_VALID_LTV must revert'
      );
    });
  });

  // ── getLiquidationThreshold / setLiquidationThreshold ───────────────────────

  describe('getLiquidationThreshold() / setLiquidationThreshold()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getLiquidationThreshold(), 0n);
    });

    it('set and read back liquidation threshold', async () => {
      const mock = await deploy();
      await mock.write.setLiquidationThreshold([8500n]);
      assert.equal(await mock.read.getLiquidationThreshold(), 8500n);
      // Threshold is the 2nd param (index 1)
      await assertParams(mock, [0n, 8500n, 0n, 0n, 0n, 0n]);
    });

    it('set to MAX_VALID_LIQUIDATION_THRESHOLD succeeds', async () => {
      const mock = await deploy();
      await mock.write.setLiquidationThreshold([MAX_VALID_LIQUIDATION_THRESHOLD]);
      assert.equal(await mock.read.getLiquidationThreshold(), MAX_VALID_LIQUIDATION_THRESHOLD);
    });

    it('set to MAX_VALID_LIQUIDATION_THRESHOLD + 1 reverts', async () => {
      const mock = await deploy();
      await assert.rejects(
        mock.write.setLiquidationThreshold([MAX_VALID_LIQUIDATION_THRESHOLD + 1n]),
        'threshold > MAX must revert'
      );
    });
  });

  // ── getLiquidationBonus / setLiquidationBonus ─────────────────────────────────

  describe('getLiquidationBonus() / setLiquidationBonus()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getLiquidationBonus(), 0n);
    });

    it('set and read back liquidation bonus', async () => {
      const mock = await deploy();
      await mock.write.setLiquidationBonus([LB]);
      assert.equal(await mock.read.getLiquidationBonus(), LB);
      // Bonus is the 3rd param (index 2)
      await assertParams(mock, [0n, 0n, LB, 0n, 0n, 0n]);
    });

    it('clear bonus back to 0', async () => {
      const mock = await deploy();
      await mock.write.setLiquidationBonus([LB]);
      await mock.write.setLiquidationBonus([0n]);
      assert.equal(await mock.read.getLiquidationBonus(), 0n);
    });
  });

  // ── getDecimals / setDecimals ─────────────────────────────────────────────────

  describe('getDecimals() / setDecimals()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getDecimals(), 0n);
    });

    it('set and read back decimals', async () => {
      const mock = await deploy();
      await mock.write.setDecimals([DECIMALS]);
      assert.equal(await mock.read.getDecimals(), DECIMALS);
      // Decimals is the 4th param (index 3)
      await assertParams(mock, [0n, 0n, 0n, DECIMALS, 0n, 0n]);
    });

    it('set to MAX_VALID_DECIMALS succeeds', async () => {
      const mock = await deploy();
      await mock.write.setDecimals([MAX_VALID_DECIMALS]);
      assert.equal(await mock.read.getDecimals(), MAX_VALID_DECIMALS);
    });

    it('set to MAX_VALID_DECIMALS + 1 reverts', async () => {
      const mock = await deploy();
      await assert.rejects(
        mock.write.setDecimals([MAX_VALID_DECIMALS + 1n]),
        'decimals > MAX must revert'
      );
    });
  });

  // ── getEModeCategory / setEModeCategory ───────────────────────────────────────

  describe('getEModeCategory() / setEModeCategory()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getEModeCategory(), 0n);
    });

    it('set and read back eMode category', async () => {
      const mock = await deploy();
      await mock.write.setEModeCategory([EMODE_CATEGORY]);
      assert.equal(await mock.read.getEModeCategory(), EMODE_CATEGORY);
      // eMode category is the 6th param (index 5)
      await assertParams(mock, [0n, 0n, 0n, 0n, 0n, EMODE_CATEGORY]);
    });

    it('set to MAX_VALID_EMODE_CATEGORY succeeds', async () => {
      const mock = await deploy();
      await mock.write.setEModeCategory([MAX_VALID_EMODE_CATEGORY]);
      assert.equal(await mock.read.getEModeCategory(), MAX_VALID_EMODE_CATEGORY);
    });

    it('set to MAX_VALID_EMODE_CATEGORY + 1 reverts', async () => {
      const mock = await deploy();
      await assert.rejects(
        mock.write.setEModeCategory([MAX_VALID_EMODE_CATEGORY + 1n]),
        'eMode category > MAX must revert'
      );
    });
  });

  // ── getReserveFactor / setReserveFactor ───────────────────────────────────────

  describe('getReserveFactor() / setReserveFactor()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getReserveFactor(), 0n);
    });

    it('set and read back reserve factor', async () => {
      const mock = await deploy();
      await mock.write.setReserveFactor([RESERVE_FACTOR]);
      assert.equal(await mock.read.getReserveFactor(), RESERVE_FACTOR);
      // Reserve factor is the 5th param (index 4)
      await assertParams(mock, [0n, 0n, 0n, 0n, RESERVE_FACTOR, 0n]);
    });

    it('clear reserve factor back to 0', async () => {
      const mock = await deploy();
      await mock.write.setReserveFactor([RESERVE_FACTOR]);
      await mock.write.setReserveFactor([0n]);
      assert.equal(await mock.read.getReserveFactor(), 0n);
    });

    it('set to MAX_VALID_RESERVE_FACTOR succeeds', async () => {
      const mock = await deploy();
      await mock.write.setReserveFactor([MAX_VALID_RESERVE_FACTOR]);
      assert.equal(await mock.read.getReserveFactor(), MAX_VALID_RESERVE_FACTOR);
    });

    it('set to MAX_VALID_RESERVE_FACTOR + 1 reverts', async () => {
      const mock = await deploy();
      await assert.rejects(
        mock.write.setReserveFactor([MAX_VALID_RESERVE_FACTOR + 1n]),
        'reserve factor > MAX must revert'
      );
    });
  });

  // ── getBorrowCap / setBorrowCap ───────────────────────────────────────────────

  describe('getBorrowCap() / setBorrowCap()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getBorrowCap(), 0n);
    });

    it('set and read back borrow cap', async () => {
      const mock = await deploy();
      await mock.write.setBorrowCap([BORROW_CAP]);
      assert.equal(await mock.read.getBorrowCap(), BORROW_CAP);
      // Borrow cap is the 1st cap
      await assertCaps(mock, [BORROW_CAP, 0n]);
    });

    it('clear borrow cap back to 0', async () => {
      const mock = await deploy();
      await mock.write.setBorrowCap([BORROW_CAP]);
      await mock.write.setBorrowCap([0n]);
      assert.equal(await mock.read.getBorrowCap(), 0n);
      await assertCaps(mock, [0n, 0n]);
    });
  });

  // ── getSupplyCap / setSupplyCap ───────────────────────────────────────────────

  describe('getSupplyCap() / setSupplyCap()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getSupplyCap(), 0n);
    });

    it('set and read back supply cap', async () => {
      const mock = await deploy();
      await mock.write.setSupplyCap([SUPPLY_CAP]);
      assert.equal(await mock.read.getSupplyCap(), SUPPLY_CAP);
      // Supply cap is the 2nd cap
      await assertCaps(mock, [0n, SUPPLY_CAP]);
    });

    it('clear supply cap back to 0', async () => {
      const mock = await deploy();
      await mock.write.setSupplyCap([SUPPLY_CAP]);
      await mock.write.setSupplyCap([0n]);
      assert.equal(await mock.read.getSupplyCap(), 0n);
    });
  });

  // ── getUnbackedMintCap / setUnbackedMintCap ───────────────────────────────────

  describe('getUnbackedMintCap() / setUnbackedMintCap()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getUnbackedMintCap(), 0n);
    });

    it('set and read back unbacked mint cap', async () => {
      const mock = await deploy();
      await mock.write.setUnbackedMintCap([UNBACKED_MINT_CAP]);
      assert.equal(await mock.read.getUnbackedMintCap(), UNBACKED_MINT_CAP);
    });

    it('clear unbacked mint cap back to 0', async () => {
      const mock = await deploy();
      await mock.write.setUnbackedMintCap([UNBACKED_MINT_CAP]);
      await mock.write.setUnbackedMintCap([0n]);
      assert.equal(await mock.read.getUnbackedMintCap(), 0n);
    });
  });

  // ── getLiquidationProtocolFee / setLiquidationProtocolFee ────────────────────

  describe('getLiquidationProtocolFee() / setLiquidationProtocolFee()', () => {
    it('starts at 0', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getLiquidationProtocolFee(), 0n);
    });

    it('set and read back liquidation protocol fee', async () => {
      const mock = await deploy();
      await mock.write.setLiquidationProtocolFee([5000n]);
      assert.equal(await mock.read.getLiquidationProtocolFee(), 5000n);
    });

    it('set to MAX_VALID_LIQUIDATION_PROTOCOL_FEE succeeds', async () => {
      const mock = await deploy();
      await mock.write.setLiquidationProtocolFee([MAX_VALID_LIQUIDATION_PROTOCOL_FEE]);
      assert.equal(await mock.read.getLiquidationProtocolFee(), MAX_VALID_LIQUIDATION_PROTOCOL_FEE);
    });

    it('set to MAX_VALID_LIQUIDATION_PROTOCOL_FEE + 1 reverts', async () => {
      const mock = await deploy();
      await assert.rejects(
        mock.write.setLiquidationProtocolFee([MAX_VALID_LIQUIDATION_PROTOCOL_FEE + 1n]),
        'liquidation protocol fee > MAX must revert'
      );
    });
  });

  // ── Boolean flags ─────────────────────────────────────────────────────────────

  describe('boolean flags via getFlags()', () => {
    it('getFlags() initially all false', async () => {
      const mock = await deploy();
      // Returns (isActive, isFrozen, isBorrowingEnabled, isStableBorrowRateEnabled, isPaused)
      const flags = await mock.read.getFlags();
      assert.deepEqual(flags, [false, false, false, false, false]);
    });

    it('setFrozen(true) sets frozen flag (2nd flag)', async () => {
      const mock = await deploy();
      await mock.write.setFrozen([true]);
      const flags = await mock.read.getFlags();
      // [isActive=false, isFrozen=true, borrowingEnabled=false, stableEnabled=false, isPaused=false]
      assert.equal(flags[1], true, 'isFrozen must be true');
      assert.equal(flags[0], false, 'isActive must stay false');
      assert.equal(await mock.read.getFrozen(), true);
    });

    it('setFrozen(false) clears frozen flag', async () => {
      const mock = await deploy();
      await mock.write.setFrozen([true]);
      await mock.write.setFrozen([false]);
      assert.equal(await mock.read.getFrozen(), false);
      const flags = await mock.read.getFlags();
      assert.deepEqual(flags, [false, false, false, false, false]);
    });

    it('setBorrowingEnabled(true) sets borrowing flag (3rd flag)', async () => {
      const mock = await deploy();
      await mock.write.setBorrowingEnabled([true]);
      const flags = await mock.read.getFlags();
      assert.equal(flags[2], true, 'borrowingEnabled must be true');
      assert.equal(await mock.read.getBorrowingEnabled(), true);
    });

    it('setBorrowingEnabled(false) clears borrowing flag', async () => {
      const mock = await deploy();
      await mock.write.setBorrowingEnabled([true]);
      await mock.write.setBorrowingEnabled([false]);
      assert.equal(await mock.read.getBorrowingEnabled(), false);
    });

    it('setStableRateBorrowingEnabled(true) sets stable flag (4th flag)', async () => {
      const mock = await deploy();
      await mock.write.setStableRateBorrowingEnabled([true]);
      const flags = await mock.read.getFlags();
      assert.equal(flags[3], true, 'stableRateBorrowingEnabled must be true');
      assert.equal(await mock.read.getStableRateBorrowingEnabled(), true);
    });

    it('setStableRateBorrowingEnabled(false) clears stable flag', async () => {
      const mock = await deploy();
      await mock.write.setStableRateBorrowingEnabled([true]);
      await mock.write.setStableRateBorrowingEnabled([false]);
      assert.equal(await mock.read.getStableRateBorrowingEnabled(), false);
    });
  });

  // ── getFlashLoanEnabled / setFlashLoanEnabled ────────────────────────────────

  describe('getFlashLoanEnabled() / setFlashLoanEnabled()', () => {
    it('starts as false', async () => {
      const mock = await deploy();
      assert.equal(await mock.read.getFlashLoanEnabled(), false);
    });

    it('enable flash loans', async () => {
      const mock = await deploy();
      await mock.write.setFlashLoanEnabled([true]);
      assert.equal(await mock.read.getFlashLoanEnabled(), true);
    });

    it('disable flash loans', async () => {
      const mock = await deploy();
      await mock.write.setFlashLoanEnabled([true]);
      await mock.write.setFlashLoanEnabled([false]);
      assert.equal(await mock.read.getFlashLoanEnabled(), false);
    });
  });

  // ── Bitfield isolation ─────────────────────────────────────────────────────────

  describe('bitfield isolation — setting one field does not corrupt others', () => {
    it('setting LTV does not affect liquidation threshold', async () => {
      const mock = await deploy();
      await mock.write.setLtv([LTV]);
      await mock.write.setLiquidationThreshold([8500n]);
      assert.equal(await mock.read.getLtv(), LTV);
      assert.equal(await mock.read.getLiquidationThreshold(), 8500n);
    });

    it('setting decimals does not affect reserve factor', async () => {
      const mock = await deploy();
      await mock.write.setDecimals([DECIMALS]);
      await mock.write.setReserveFactor([RESERVE_FACTOR]);
      assert.equal(await mock.read.getDecimals(), DECIMALS);
      assert.equal(await mock.read.getReserveFactor(), RESERVE_FACTOR);
    });

    it('setting borrow cap does not affect supply cap', async () => {
      const mock = await deploy();
      await mock.write.setBorrowCap([BORROW_CAP]);
      await mock.write.setSupplyCap([SUPPLY_CAP]);
      assert.equal(await mock.read.getBorrowCap(), BORROW_CAP);
      assert.equal(await mock.read.getSupplyCap(), SUPPLY_CAP);
    });

    it('setting all main params independently produces correct combined getParams()', async () => {
      const mock = await deploy();
      await mock.write.setLtv([LTV]);
      await mock.write.setLiquidationThreshold([8500n]);
      await mock.write.setLiquidationBonus([LB]);
      await mock.write.setDecimals([DECIMALS]);
      await mock.write.setReserveFactor([RESERVE_FACTOR]);
      await mock.write.setEModeCategory([EMODE_CATEGORY]);

      const params = await mock.read.getParams();
      assert.equal(params[0], LTV, 'LTV mismatch');
      assert.equal(params[1], 8500n, 'threshold mismatch');
      assert.equal(params[2], LB, 'bonus mismatch');
      assert.equal(params[3], DECIMALS, 'decimals mismatch');
      assert.equal(params[4], RESERVE_FACTOR, 'reserve factor mismatch');
      assert.equal(params[5], EMODE_CATEGORY, 'eMode category mismatch');
    });

    it('boolean flag and numeric param coexist without corruption', async () => {
      const mock = await deploy();
      await mock.write.setFrozen([true]);
      await mock.write.setBorrowingEnabled([true]);
      await mock.write.setLtv([LTV]);
      await mock.write.setReserveFactor([RESERVE_FACTOR]);

      assert.equal(await mock.read.getLtv(), LTV);
      assert.equal(await mock.read.getReserveFactor(), RESERVE_FACTOR);
      assert.equal(await mock.read.getFrozen(), true);
      assert.equal(await mock.read.getBorrowingEnabled(), true);
    });
  });
});
