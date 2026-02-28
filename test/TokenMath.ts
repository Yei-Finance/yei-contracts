/**
 * TokenMath — full coverage
 *
 * Tests every function in TokenMath with exact rounding verification.
 * Key properties under test:
 *   - Supply mint  → floor (user gets fewer aTokens)
 *   - Supply burn  → ceil  (user burns more aTokens)
 *   - Borrow mint  → ceil  (user accumulates more debt)
 *   - Borrow burn  → floor (less debt burned = protocol still owed)
 *   - AToken balance → floor (user sees slightly less)
 *   - VToken balance → ceil  (user sees slightly more debt)
 *
 * No tolerance buffers — all comparisons are exact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';

const RAY = 10n ** 27n;

// ─── JS reference implementations ────────────────────────────────────────────

const rayDivFloor = (a: bigint, b: bigint) => (a * RAY) / b;
const rayDivCeil = (a: bigint, b: bigint) => (a * RAY + b - 1n) / b;
const rayMulFloor = (a: bigint, b: bigint) => (a * b) / RAY;
const rayMulCeil = (a: bigint, b: bigint) => {
  const product = a * b;
  return product / RAY + (product % RAY > 0n ? 1n : 0n);
};

// ─── setup ────────────────────────────────────────────────────────────────────

const { viem } = await network.connect();
const wrapper = await viem.deployContract('TokenMathWrapper');

// ─── tests ────────────────────────────────────────────────────────────────────

describe('TokenMath', () => {
  // ─── AToken supply side ───────────────────────────────────────────────────

  describe('getATokenMintScaledAmount() — rayDivFloor (supply, floor)', () => {
    it('exact: amount=1, index=RAY → 1 scaled token (1 wei at 1:1 index)', async () => {
      // rayDivFloor(1, RAY) = 1 * RAY / RAY = 1
      assert.equal(await wrapper.read.getATokenMintScaledAmount([1n, RAY]), 1n);
    });

    it('floors: 3 underlying / (2*RAY index) → 1 scaled (not 2)', async () => {
      const amount = 3n;
      const index = 2n * RAY;
      assert.equal(await wrapper.read.getATokenMintScaledAmount([amount, index]), 1n);
    });

    it('matches reference rayDivFloor for arbitrary inputs', async () => {
      const amount = 1_000_000_000_000_000_001n; // 1 ETH + 1 wei
      const index = 1_050_000_000_000_000_000_000_000_000n; // 1.05 * RAY
      const expected = rayDivFloor(amount, index);
      assert.equal(await wrapper.read.getATokenMintScaledAmount([amount, index]), expected);
    });

    it('mint <= burn for same inputs (protocol never over-credits supply side)', async () => {
      const amount = 999_999_999_999_999_999n;
      const index = RAY + 123_456_789n;
      const mint = await wrapper.read.getATokenMintScaledAmount([amount, index]);
      const burn = await wrapper.read.getATokenBurnScaledAmount([amount, index]);
      assert.ok(mint <= burn, `mint ${mint} > burn ${burn}`);
    });
  });

  describe('getATokenBurnScaledAmount() — rayDivCeil (withdraw, ceil)', () => {
    it('exact: amount=1, index=RAY → 1 scaled token (no rounding when exact)', async () => {
      // rayDivCeil(1, RAY) = (1 * RAY + RAY - 1) / RAY = (2*RAY - 1) / RAY = 1
      assert.equal(await wrapper.read.getATokenBurnScaledAmount([1n, RAY]), 1n);
    });

    it('ceils: 3 underlying / (2*RAY index) → 2 scaled (not 1)', async () => {
      const amount = 3n;
      const index = 2n * RAY;
      assert.equal(await wrapper.read.getATokenBurnScaledAmount([amount, index]), 2n);
    });

    it('matches reference rayDivCeil for arbitrary inputs', async () => {
      const amount = 1_000_000_000_000_000_001n;
      const index = 1_050_000_000_000_000_000_000_000_000n;
      const expected = rayDivCeil(amount, index);
      assert.equal(await wrapper.read.getATokenBurnScaledAmount([amount, index]), expected);
    });

    it('burn = mint + 1 when remainder exists (rounding gap is exactly 1 unit)', async () => {
      const amount = 3n;
      const index = 2n * RAY + 1n; // non-exact division
      const mint = await wrapper.read.getATokenMintScaledAmount([amount, index]);
      const burn = await wrapper.read.getATokenBurnScaledAmount([amount, index]);
      assert.equal(burn, mint + 1n);
    });
  });

  describe('getATokenTransferScaledAmount() — rayDivCeil (transfer, ceil)', () => {
    it('exact: same result as burn scaled amount', async () => {
      const amount = 1_000_000_000_000_000_000n;
      const index = RAY;
      const burn = await wrapper.read.getATokenBurnScaledAmount([amount, index]);
      const transfer = await wrapper.read.getATokenTransferScaledAmount([amount, index]);
      assert.equal(transfer, burn);
    });

    it("ceils: sender's balance is sufficiently reduced", async () => {
      const amount = 3n;
      const index = 2n * RAY;
      assert.equal(await wrapper.read.getATokenTransferScaledAmount([amount, index]), 2n);
    });

    it('matches reference rayDivCeil', async () => {
      const amount = 7_777_777_777_777_777_777n;
      const index = 1_020_000_000_000_000_000_000_000_000n;
      assert.equal(
        await wrapper.read.getATokenTransferScaledAmount([amount, index]),
        rayDivCeil(amount, index)
      );
    });
  });

  describe('getATokenBalance() — rayMulFloor (aToken balance, floor)', () => {
    it('exact: scaledBalance=1, index=RAY → 1 underlying', async () => {
      assert.equal(await wrapper.read.getATokenBalance([1n, RAY]), 1n);
    });

    it('floors: 1 scaled * (RAY+1) index → 1 (not 2)', async () => {
      // 1 * (RAY+1) / RAY = 1.000...1 → floor = 1
      assert.equal(await wrapper.read.getATokenBalance([1n, RAY + 1n]), 1n);
    });

    it('matches reference rayMulFloor for arbitrary inputs', async () => {
      const scaled = 952_380_952_380_952_380n;
      const index = 1_050_000_000_000_000_000_000_000_000n;
      assert.equal(
        await wrapper.read.getATokenBalance([scaled, index]),
        rayMulFloor(scaled, index)
      );
    });

    it('aToken balance <= vToken balance for same inputs (floor <= ceil)', async () => {
      const scaled = 1_234_567_890_123_456_789n;
      const index = RAY + 500_000_000n;
      const aBalance = await wrapper.read.getATokenBalance([scaled, index]);
      const vBalance = await wrapper.read.getVTokenBalance([scaled, index]);
      assert.ok(aBalance <= vBalance, `aTokenBalance ${aBalance} > vTokenBalance ${vBalance}`);
    });
  });

  // ─── VToken borrow side ───────────────────────────────────────────────────

  describe('getVTokenMintScaledAmount() — rayDivCeil (borrow, ceil)', () => {
    it('exact: amount=1, index=RAY → 1 scaled token (no rounding)', async () => {
      assert.equal(await wrapper.read.getVTokenMintScaledAmount([1n, RAY]), 1n);
    });

    it('ceils: 3 underlying / (2*RAY index) → 2 scaled debt (not 1)', async () => {
      assert.equal(await wrapper.read.getVTokenMintScaledAmount([3n, 2n * RAY]), 2n);
    });

    it('matches reference rayDivCeil for arbitrary inputs', async () => {
      const amount = 1_000_000_000_000_000_001n;
      const index = 1_050_000_000_000_000_000_000_000_000n;
      assert.equal(
        await wrapper.read.getVTokenMintScaledAmount([amount, index]),
        rayDivCeil(amount, index)
      );
    });

    it('vToken mint >= aToken mint for same inputs (debt side rounded up)', async () => {
      const amount = 999_999_999_999_999_999n;
      const index = RAY + 123_456_789n;
      const aMint = await wrapper.read.getATokenMintScaledAmount([amount, index]);
      const vMint = await wrapper.read.getVTokenMintScaledAmount([amount, index]);
      assert.ok(vMint >= aMint, `vMint ${vMint} < aMint ${aMint}`);
    });
  });

  describe('getVTokenBurnScaledAmount() — rayDivFloor (repay, floor)', () => {
    it('exact: amount=1, index=RAY → 1 scaled token (no rounding)', async () => {
      assert.equal(await wrapper.read.getVTokenBurnScaledAmount([1n, RAY]), 1n);
    });

    it('floors: 3 underlying / (2*RAY index) → 1 scaled (not 2)', async () => {
      assert.equal(await wrapper.read.getVTokenBurnScaledAmount([3n, 2n * RAY]), 1n);
    });

    it('matches reference rayDivFloor for arbitrary inputs', async () => {
      const amount = 1_000_000_000_000_000_001n;
      const index = 1_050_000_000_000_000_000_000_000_000n;
      assert.equal(
        await wrapper.read.getVTokenBurnScaledAmount([amount, index]),
        rayDivFloor(amount, index)
      );
    });

    it('vToken burn <= vToken mint (repaying less than borrowed keeps protocol safe)', async () => {
      const amount = 1_234_567_890_123_456_789n;
      const index = RAY + 123_456_789n;
      const mint = await wrapper.read.getVTokenMintScaledAmount([amount, index]);
      const burn = await wrapper.read.getVTokenBurnScaledAmount([amount, index]);
      assert.ok(burn <= mint, `burn ${burn} > mint ${mint}`);
    });
  });

  describe('getVTokenBalance() — rayMulCeil (debt balance, ceil)', () => {
    it('exact: scaledBalance=1, index=RAY → 1 underlying', async () => {
      assert.equal(await wrapper.read.getVTokenBalance([1n, RAY]), 1n);
    });

    it('ceils: 1 scaled * (RAY+1) index → 2 (not 1)', async () => {
      // 1 * (RAY+1) / RAY = 1.000...1 → ceil = 2
      assert.equal(await wrapper.read.getVTokenBalance([1n, RAY + 1n]), 2n);
    });

    it('matches reference rayMulCeil for arbitrary inputs', async () => {
      const scaled = 952_380_952_380_952_380n;
      const index = 1_050_000_000_000_000_000_000_000_000n;
      assert.equal(await wrapper.read.getVTokenBalance([scaled, index]), rayMulCeil(scaled, index));
    });
  });

  // ─── Protocol rounding invariants ─────────────────────────────────────────

  describe('protocol rounding invariants', () => {
    const amount = 1_234_567_890_123_456_789_012n;
    const index = 12_345_678_901_234_567_890_123_456_789n; // ~12.35 * RAY

    it('supply: burn >= mint (protocol retains any fractional scaled balance)', async () => {
      const mint = await wrapper.read.getATokenMintScaledAmount([amount, index]);
      const burn = await wrapper.read.getATokenBurnScaledAmount([amount, index]);
      assert.ok(burn >= mint, `aToken burn ${burn} < mint ${mint}`);
    });

    it('borrow: mint >= burn (protocol always owed at least as much as was credited)', async () => {
      const mint = await wrapper.read.getVTokenMintScaledAmount([amount, index]);
      const burn = await wrapper.read.getVTokenBurnScaledAmount([amount, index]);
      assert.ok(mint >= burn, `vToken mint ${mint} < burn ${burn}`);
    });

    it('supply: aToken balance uses floor (depositor sees less)', async () => {
      // After exact mint, balance with higher index should be floor not ceil
      const scaled = await wrapper.read.getATokenMintScaledAmount([amount, index]);
      const balFloor = await wrapper.read.getATokenBalance([scaled, index]);
      const balCeil = await wrapper.read.getVTokenBalance([scaled, index]);
      assert.ok(balFloor <= balCeil);
    });

    it('borrow: vToken balance uses ceil (borrower sees more debt)', async () => {
      const scaled = await wrapper.read.getVTokenMintScaledAmount([amount, index]);
      const balFloor = await wrapper.read.getATokenBalance([scaled, index]);
      const balCeil = await wrapper.read.getVTokenBalance([scaled, index]);
      assert.ok(balCeil >= balFloor);
    });

    it('rounding gap is exactly 0 or 1 (no excessive precision loss)', async () => {
      const mint = await wrapper.read.getATokenMintScaledAmount([amount, index]);
      const burn = await wrapper.read.getATokenBurnScaledAmount([amount, index]);
      const gap = burn - mint;
      assert.ok(gap === 0n || gap === 1n, `Gap is ${gap}, expected 0 or 1`);
    });

    it('borrow rounding gap is exactly 0 or 1', async () => {
      const mint = await wrapper.read.getVTokenMintScaledAmount([amount, index]);
      const burn = await wrapper.read.getVTokenBurnScaledAmount([amount, index]);
      const gap = mint - burn;
      assert.ok(gap === 0n || gap === 1n, `Gap is ${gap}, expected 0 or 1`);
    });
  });
});
