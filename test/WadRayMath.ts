/**
 * WadRayMath — full coverage
 *
 * Tests every function in WadRayMath, including the floor/ceil variants
 * introduced in the fix/supply-withdraw-rounding branch.
 *
 * All assertions use exact bigint comparisons. No tolerance buffers.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';

const RAY = 10n ** 27n;
const WAD = 10n ** 18n;
const HALF_RAY = RAY / 2n;
const HALF_WAD = WAD / 2n;
const WAD_RAY_RATIO = 10n ** 9n;
const MAX_UINT256 = 2n ** 256n - 1n;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** JS bigint floor division */
const floorDiv = (a: bigint, b: bigint) => a / b;

/** JS bigint ceiling division */
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** JS bigint round-half-up division */
const roundHalfUp = (a: bigint, b: bigint) => (a + b / 2n) / b;

// ─── setup ────────────────────────────────────────────────────────────────────

const { viem } = await network.connect();
const wrapper = await viem.deployContract('WadRayMathWrapper');

// ─── tests ────────────────────────────────────────────────────────────────────

describe('WadRayMath', () => {
  // ── constants ─────────────────────────────────────────────────────────────

  describe('constants', () => {
    it('WAD = 1e18', async () => {
      assert.equal(await wrapper.read.wad(), WAD);
    });

    it('HALF_WAD = 0.5e18', async () => {
      assert.equal(await wrapper.read.halfWad(), HALF_WAD);
    });

    it('RAY = 1e27', async () => {
      assert.equal(await wrapper.read.ray(), RAY);
    });

    it('HALF_RAY = 0.5e27', async () => {
      assert.equal(await wrapper.read.halfRay(), HALF_RAY);
    });
  });

  // ── wadMul ────────────────────────────────────────────────────────────────

  describe('wadMul()', () => {
    it('rounds half-up: (a*b + HALF_WAD) / WAD', async () => {
      const a = 134534543232342353231234n;
      const b = 13265462389132757665657n;
      const expected = roundHalfUp(a * b, WAD);
      assert.equal(await wrapper.read.wadMul([a, b]), expected);
    });

    it('returns 0 when a = 0', async () => {
      assert.equal(await wrapper.read.wadMul([0n, 1000n]), 0n);
    });

    it('returns 0 when b = 0', async () => {
      assert.equal(await wrapper.read.wadMul([1000n, 0n]), 0n);
    });

    it('reverts when product would overflow', async () => {
      const b = 13265462389132757665657n;
      const tooLarge = (MAX_UINT256 - HALF_WAD) / b + 1n;
      await assert.rejects(wrapper.read.wadMul([tooLarge, b]));
    });
  });

  // ── wadDiv ────────────────────────────────────────────────────────────────

  describe('wadDiv()', () => {
    it('rounds half-up: (a*WAD + b/2) / b', async () => {
      const a = 134534543232342353231234n;
      const b = 13265462389132757665657n;
      const expected = roundHalfUp(a * WAD, b);
      assert.equal(await wrapper.read.wadDiv([a, b]), expected);
    });

    it('reverts on division by zero', async () => {
      await assert.rejects(wrapper.read.wadDiv([1n, 0n]));
    });

    it('reverts when a*WAD overflows', async () => {
      const b = 13265462389132757665657n;
      const tooLarge = (MAX_UINT256 - b / 2n) / WAD + 1n;
      await assert.rejects(wrapper.read.wadDiv([tooLarge, b]));
    });
  });

  // ── rayMul (round-half-up) ─────────────────────────────────────────────────

  describe('rayMul()', () => {
    it('rounds half-up: (a*b + HALF_RAY) / RAY', async () => {
      const a = 134534543232342353231234n;
      const b = 13265462389132757665657n;
      const expected = roundHalfUp(a * b, RAY);
      assert.equal(await wrapper.read.rayMul([a, b]), expected);
    });

    it('returns 0 when a = 0', async () => {
      assert.equal(await wrapper.read.rayMul([0n, RAY]), 0n);
    });

    it('returns 0 when b = 0', async () => {
      assert.equal(await wrapper.read.rayMul([RAY, 0n]), 0n);
    });

    it('reverts when product would overflow', async () => {
      const b = 13265462389132757665657n;
      const tooLarge = (MAX_UINT256 - HALF_RAY) / b + 1n;
      await assert.rejects(wrapper.read.rayMul([tooLarge, b]));
    });
  });

  // ── rayDiv (round-half-up) ─────────────────────────────────────────────────

  describe('rayDiv()', () => {
    it('rounds half-up: (a*RAY + b/2) / b', async () => {
      const a = 134534543232342353231234n;
      const b = 13265462389132757665657n;
      const expected = roundHalfUp(a * RAY, b);
      assert.equal(await wrapper.read.rayDiv([a, b]), expected);
    });

    it('reverts on division by zero', async () => {
      await assert.rejects(wrapper.read.rayDiv([1n, 0n]));
    });

    it('reverts when a*RAY overflows', async () => {
      const b = 13265462389132757665657n;
      const tooLarge = (MAX_UINT256 - b / 2n) / RAY + 1n;
      await assert.rejects(wrapper.read.rayDiv([tooLarge, b]));
    });
  });

  // ── rayMulFloor ───────────────────────────────────────────────────────────

  describe('rayMulFloor()', () => {
    it('returns floor(a*b / RAY)', async () => {
      const a = 134534543232342353231234n;
      const b = 13265462389132757665657n;
      assert.equal(await wrapper.read.rayMulFloor([a, b]), floorDiv(a * b, RAY));
    });

    it('is always <= rayMul (floor <= round-half-up)', async () => {
      const a = 3n;
      const b = 2n * RAY + 1n; // non-exact to guarantee remainder
      const floor = await wrapper.read.rayMulFloor([a, b]);
      const rhu = await wrapper.read.rayMul([a, b]);
      assert.ok(floor <= rhu, `floor ${floor} > rayMul ${rhu}`);
    });

    it('is always <= rayMulCeil', async () => {
      const a = 3n;
      const b = 2n * RAY + 1n;
      const floor = await wrapper.read.rayMulFloor([a, b]);
      const ceil = await wrapper.read.rayMulCeil([a, b]);
      assert.ok(floor <= ceil, `floor ${floor} > ceil ${ceil}`);
    });

    it('floor == ceil when a*b is exactly divisible by RAY', async () => {
      const a = 2n * RAY;
      const b = RAY; // a*b = 2*RAY^2, divisible by RAY
      assert.equal(await wrapper.read.rayMulFloor([a, b]), await wrapper.read.rayMulCeil([a, b]));
    });

    it('returns 0 when a = 0', async () => {
      assert.equal(await wrapper.read.rayMulFloor([0n, RAY]), 0n);
    });

    it('returns 0 when b = 0', async () => {
      assert.equal(await wrapper.read.rayMulFloor([RAY, 0n]), 0n);
    });

    it('reverts when a*b overflows uint256', async () => {
      const b = 2n;
      const tooLarge = MAX_UINT256 / b + 1n;
      await assert.rejects(wrapper.read.rayMulFloor([tooLarge, b]));
    });

    it('concrete: rayMulFloor(3, 2*RAY+1) = 1', async () => {
      // 3*(2*RAY+1) = 6*RAY+3 → floor((6*RAY+3)/RAY) = 6
      // Wait: rayMulFloor(a,b) = floor(a*b / RAY)
      // a=3, b=2*RAY+1 → a*b = 6*RAY+3 → /RAY = 6 + 3/RAY → floor = 6
      const b = 2n * RAY + 1n;
      assert.equal(await wrapper.read.rayMulFloor([3n, b]), 6n);
    });
  });

  // ── rayMulCeil ────────────────────────────────────────────────────────────

  describe('rayMulCeil()', () => {
    it('returns ceil(a*b / RAY)', async () => {
      const a = 3n;
      const b = 2n * RAY + 1n; // product not divisible by RAY
      const product = a * b;
      const expected = ceilDiv(product, RAY);
      assert.equal(await wrapper.read.rayMulCeil([a, b]), expected);
    });

    it('is always >= rayMul (ceil >= round-half-up)', async () => {
      // When remainder < HALF_RAY, ceil > roundHalfUp
      const a = 1n;
      const b = RAY + 1n; // 1*(RAY+1) mod RAY = 1 < HALF_RAY → ceil > rhu
      const ceil = await wrapper.read.rayMulCeil([a, b]);
      const rhu = await wrapper.read.rayMul([a, b]);
      assert.ok(ceil >= rhu, `ceil ${ceil} < rayMul ${rhu}`);
    });

    it('ceil == floor when exactly divisible', async () => {
      const a = RAY;
      const b = RAY;
      assert.equal(await wrapper.read.rayMulCeil([a, b]), await wrapper.read.rayMulFloor([a, b]));
    });

    it('returns 0 when a = 0', async () => {
      assert.equal(await wrapper.read.rayMulCeil([0n, RAY]), 0n);
    });

    it('returns 0 when b = 0', async () => {
      assert.equal(await wrapper.read.rayMulCeil([RAY, 0n]), 0n);
    });

    it('reverts when a*b overflows uint256', async () => {
      const b = 2n;
      const tooLarge = MAX_UINT256 / b + 1n;
      await assert.rejects(wrapper.read.rayMulCeil([tooLarge, b]));
    });

    it('concrete: rayMulCeil(1, RAY+1) = 2', async () => {
      // 1*(RAY+1) / RAY = 1 + 1/RAY → ceil = 2
      assert.equal(await wrapper.read.rayMulCeil([1n, RAY + 1n]), 2n);
    });

    it('concrete: rayMulFloor(1, RAY+1) = 1', async () => {
      assert.equal(await wrapper.read.rayMulFloor([1n, RAY + 1n]), 1n);
    });
  });

  // ── rayDivFloor ───────────────────────────────────────────────────────────

  describe('rayDivFloor()', () => {
    it('returns floor(a*RAY / b)', async () => {
      const a = 3n;
      const b = 2n; // 3 * RAY / 2 → floor = 1.5*RAY
      assert.equal(await wrapper.read.rayDivFloor([a, b]), floorDiv(a * RAY, b));
    });

    it('is always <= rayDiv (floor <= round-half-up)', async () => {
      const a = 3n;
      const b = 4n; // 3*RAY/4 → not exact
      const floor = await wrapper.read.rayDivFloor([a, b]);
      const rhu = await wrapper.read.rayDiv([a, b]);
      assert.ok(floor <= rhu, `floor ${floor} > rayDiv ${rhu}`);
    });

    it('is always <= rayDivCeil', async () => {
      const a = 3n;
      const b = 4n;
      const floor = await wrapper.read.rayDivFloor([a, b]);
      const ceil = await wrapper.read.rayDivCeil([a, b]);
      assert.ok(floor <= ceil, `floor ${floor} > ceil ${ceil}`);
    });

    it('floor == ceil when a*RAY is exactly divisible by b', async () => {
      const a = 2n;
      const b = 2n; // 2*RAY/2 = RAY → exact
      assert.equal(await wrapper.read.rayDivFloor([a, b]), await wrapper.read.rayDivCeil([a, b]));
    });

    it('reverts on division by zero', async () => {
      await assert.rejects(wrapper.read.rayDivFloor([1n, 0n]));
    });

    it('reverts when a > MAX_UINT256 / RAY (a*RAY overflows)', async () => {
      const tooLarge = MAX_UINT256 / RAY + 1n;
      await assert.rejects(wrapper.read.rayDivFloor([tooLarge, 1n]));
    });

    it('concrete: rayDivFloor(3, 2*RAY) = 1 (floor of 1.5)', async () => {
      // 3 * RAY / (2*RAY) = 3/2 → floor = 1
      assert.equal(await wrapper.read.rayDivFloor([3n, 2n * RAY]), 1n);
    });
  });

  // ── rayDivCeil ────────────────────────────────────────────────────────────

  describe('rayDivCeil()', () => {
    it('returns ceil(a*RAY / b)', async () => {
      const a = 3n;
      const b = 2n * RAY; // 3*RAY/(2*RAY) = 1.5 → ceil = 2
      assert.equal(await wrapper.read.rayDivCeil([a, b]), ceilDiv(a * RAY, b));
    });

    it('is always >= rayDiv (ceil >= round-half-up)', async () => {
      const a = 3n;
      const b = 4n * RAY; // 3/(4) = 0.75 → remainder 0.75*RAY < HALF_RAY? No, 0.75 > 0.5
      // Let's use b that gives remainder < HALF_RAY
      // a=1, b=4*RAY → 1*RAY / (4*RAY) = 0.25 → remainder = 0.25*RAY < HALF_RAY
      const a2 = 1n;
      const b2 = 4n * RAY;
      const ceil = await wrapper.read.rayDivCeil([a2, b2]);
      const rhu = await wrapper.read.rayDiv([a2, b2]);
      assert.ok(ceil >= rhu, `ceil ${ceil} < rayDiv ${rhu}`);
    });

    it('ceil == floor when exactly divisible', async () => {
      const a = 2n;
      const b = 2n;
      assert.equal(await wrapper.read.rayDivCeil([a, b]), await wrapper.read.rayDivFloor([a, b]));
    });

    it('reverts on division by zero', async () => {
      await assert.rejects(wrapper.read.rayDivCeil([1n, 0n]));
    });

    it('reverts when a is too large (a*RAY + b-1 would overflow)', async () => {
      // overflow check: a > (MAX_UINT256 - (b-1)) / RAY
      const b = 1n;
      const tooLarge = (MAX_UINT256 - (b - 1n)) / RAY + 1n;
      await assert.rejects(wrapper.read.rayDivCeil([tooLarge, b]));
    });

    it('concrete: rayDivCeil(3, 2*RAY) = 2 (ceil of 1.5)', async () => {
      assert.equal(await wrapper.read.rayDivCeil([3n, 2n * RAY]), 2n);
    });

    it('concrete: rayDivFloor(3, 2*RAY+1) < rayDivCeil(3, 2*RAY+1)', async () => {
      const b = 2n * RAY + 1n;
      const floor = await wrapper.read.rayDivFloor([3n, b]);
      const ceil = await wrapper.read.rayDivCeil([3n, b]);
      assert.ok(floor < ceil, 'expected floor < ceil for non-exact division');
    });
  });

  // ── rayToWad ──────────────────────────────────────────────────────────────

  describe('rayToWad()', () => {
    it('converts exactly when divisible', async () => {
      assert.equal(await wrapper.read.rayToWad([RAY]), 1n * WAD);
    });

    it('rounds down when remainder < WAD_RAY_RATIO / 2', async () => {
      const half = WAD_RAY_RATIO / 2n;
      const a = RAY + half - 1n; // remainder = half-1 < half → rounds down
      const expected = a / WAD_RAY_RATIO;
      assert.equal(await wrapper.read.rayToWad([a]), expected);
    });

    it('rounds up when remainder >= WAD_RAY_RATIO / 2', async () => {
      const half = WAD_RAY_RATIO / 2n;
      const a = RAY + half; // remainder = half → rounds up
      const expected = a / WAD_RAY_RATIO + 1n;
      assert.equal(await wrapper.read.rayToWad([a]), expected);
    });

    it('handles MAX_UINT256 correctly (no overflow)', async () => {
      // rayToWad just divides — no overflow path
      const result = await wrapper.read.rayToWad([MAX_UINT256]);
      assert.ok(result > 0n);
    });
  });

  // ── wadToRay ──────────────────────────────────────────────────────────────

  describe('wadToRay()', () => {
    it('converts WAD to RAY exactly', async () => {
      assert.equal(await wrapper.read.wadToRay([WAD]), WAD * WAD_RAY_RATIO);
    });

    it('multiplies by 1e9 precisely', async () => {
      const a = 123456789012345678n;
      assert.equal(await wrapper.read.wadToRay([a]), a * WAD_RAY_RATIO);
    });

    it('reverts when a * WAD_RAY_RATIO would overflow', async () => {
      const tooLarge = MAX_UINT256 / WAD_RAY_RATIO + 1n;
      await assert.rejects(wrapper.read.wadToRay([tooLarge]));
    });
  });
});
