/**
 * E2E — Permit-based operations
 *
 * Covers:
 *   - Pool.sol lines 162-193: supplyWithPermit
 *   - Pool.sol lines 270-302: repayWithPermit
 *   - AToken.sol lines 179-203: permit function on aToken
 *   - EIP712Base.sol: DOMAIN_SEPARATOR, nonces
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD, VARIABLE_RATE_MODE } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

// Helper: parse a 65-byte hex signature into (v, r, s)
function splitSig(sig: `0x${string}`): { v: number; r: `0x${string}`; s: `0x${string}` } {
  const hex = sig.slice(2);
  const r = `0x${hex.slice(0, 64)}` as `0x${string}`;
  const s = `0x${hex.slice(64, 128)}` as `0x${string}`;
  const v = parseInt(hex.slice(128, 130), 16);
  return { v, r, s };
}

describe('E2E: Permit-based Operations', () => {
  // ── supplyWithPermit ─────────────────────────────────────────────────────────

  describe('supplyWithPermit()', () => {
    it('supplies an asset using an EIP-2612 permit instead of a prior approve', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1 } = ctx;

      const supplyAmt = WAD;
      await weth.write.mint([user1.account.address, supplyAmt]);
      // No approve — use permit instead

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await weth.read.nonces([user1.account.address]);
      const chainId = 31337n; // Hardhat default

      const signature = await user1.signTypedData({
        domain: {
          name: 'Wrapped Ether',
          version: '1',
          chainId,
          verifyingContract: weth.address,
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner: user1.account.address,
          spender: pool.address,
          value: supplyAmt,
          nonce,
          deadline,
        },
      });

      const { v, r, s } = splitSig(signature);

      const aBalBefore = await aWeth.read.balanceOf([user1.account.address]);
      await pool.write.supplyWithPermit(
        [weth.address, supplyAmt, user1.account.address, 0, deadline, v, r, s],
        { account: user1.account }
      );

      const aBalAfter = await aWeth.read.balanceOf([user1.account.address]);
      assert.ok(aBalAfter > aBalBefore, 'aWETH must increase after supplyWithPermit');
    });
  });

  // ── repayWithPermit ──────────────────────────────────────────────────────────

  describe('repayWithPermit()', () => {
    it('repays a debt using an EIP-2612 permit on the debt asset', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, usdc, varDebtUsdc, user1, deployer } = ctx;

      // Seed USDC
      await usdc.write.mint([deployer.account.address, 100_000n * 10n ** 6n]);
      await usdc.write.approve([pool.address, 100_000n * 10n ** 6n]);
      await pool.write.supply([usdc.address, 100_000n * 10n ** 6n, deployer.account.address, 0]);

      // user1 supplies WETH, borrows USDC
      await weth.write.mint([user1.account.address, 5n * WAD]);
      await weth.write.approve([pool.address, 5n * WAD], { account: user1.account });
      await pool.write.supply([weth.address, 5n * WAD, user1.account.address, 0], {
        account: user1.account,
      });

      const borrowAmt = 1_000n * 10n ** 6n;
      await pool.write.borrow(
        [usdc.address, borrowAmt, VARIABLE_RATE_MODE, 0, user1.account.address],
        { account: user1.account }
      );

      // Mint USDC for user1 (to repay) but do NOT approve — use permit
      const repayAmt = 500n * 10n ** 6n;
      await usdc.write.mint([user1.account.address, repayAmt]);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await usdc.read.nonces([user1.account.address]);
      const chainId = 31337n;

      const signature = await user1.signTypedData({
        domain: {
          name: 'USD Coin',
          version: '1',
          chainId,
          verifyingContract: usdc.address,
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner: user1.account.address,
          spender: pool.address,
          value: repayAmt,
          nonce,
          deadline,
        },
      });

      const { v, r, s } = splitSig(signature);

      const debtBefore = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);
      await pool.write.repayWithPermit(
        [usdc.address, repayAmt, VARIABLE_RATE_MODE, user1.account.address, deadline, v, r, s],
        { account: user1.account }
      );

      const debtAfter = await varDebtUsdc.read.scaledBalanceOf([user1.account.address]);
      assert.ok(debtAfter < debtBefore, 'debt must decrease after repayWithPermit');
    });
  });

  // ── aToken permit ────────────────────────────────────────────────────────────

  describe('AToken.permit()', () => {
    it('permit grants allowance to spender for aToken transfers', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { pool, weth, aWeth, user1, user2 } = ctx;

      // user1 supplies WETH to get aWETH
      await weth.write.mint([user1.account.address, WAD]);
      await weth.write.approve([pool.address, WAD], { account: user1.account });
      await pool.write.supply([weth.address, WAD, user1.account.address, 0], {
        account: user1.account,
      });

      const allowanceBefore = await aWeth.read.allowance([
        user1.account.address,
        user2.account.address,
      ]);
      assert.equal(allowanceBefore, 0n, 'initial allowance must be 0');

      const permitAmt = WAD / 2n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await aWeth.read.nonces([user1.account.address]);
      const chainId = 31337n;

      // aToken EIP-712 domain uses the aToken's name and address
      const aWethName = await aWeth.read.name();
      const domainSeparatorOnchain = await aWeth.read.DOMAIN_SEPARATOR();

      // Build permit hash manually matching AToken's DOMAIN_SEPARATOR logic
      // The aToken uses a dynamic domain separator (chain + address), so we sign using the
      // token name returned from the contract.
      const signature = await user1.signTypedData({
        domain: {
          name: aWethName,
          version: '1',
          chainId,
          verifyingContract: aWeth.address,
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner: user1.account.address,
          spender: user2.account.address,
          value: permitAmt,
          nonce,
          deadline,
        },
      });

      const { v, r, s } = splitSig(signature);

      await aWeth.write.permit([
        user1.account.address,
        user2.account.address,
        permitAmt,
        deadline,
        v,
        r,
        s,
      ]);

      const allowanceAfter = await aWeth.read.allowance([
        user1.account.address,
        user2.account.address,
      ]);
      assert.equal(allowanceAfter, permitAmt, 'allowance must equal permit amount');
    });
  });
});
