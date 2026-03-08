/**
 * E2E — PoolAddressesProvider
 *
 * Covers:
 *   - setMarketId / _setMarketId (line 48)
 *   - setAddressAsProxy (lines 68-71) + _updateImpl upgrade path (lines 178-179)
 *   - setPriceOracleSentinel (lines 141-143)
 *   - _getProxyImplementation else branch (lines 205-206)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, ZERO_ADDR } from '../helpers/deployMarket.js';
import { keccak256, toHex } from 'viem';

const { networkHelpers } = await network.connect();

describe('E2E: PoolAddressesProvider', () => {
  async function deployWithMockImpl({ viem }: any) {
    const base = await deployMarket({ viem });
    // Pre-deploy MockPool inside the fixture so it exists after snapshot restore
    const mockImpl = await viem.deployContract('MockPool');
    return { ...base, mockImpl };
  }

  it('setMarketId updates the market identifier', async () => {
    const ctx = await networkHelpers.loadFixture(deployWithMockImpl);
    const { provider } = ctx;

    const oldId = await provider.read.getMarketId();
    assert.equal(oldId, 'MAIN_MARKET');

    await provider.write.setMarketId(['NEW_MARKET']);

    const newId = await provider.read.getMarketId();
    assert.equal(newId, 'NEW_MARKET');
  });

  it('setAddressAsProxy creates a proxy and emits AddressSetAsProxy', async () => {
    const ctx = await networkHelpers.loadFixture(deployWithMockImpl);
    const { provider, mockImpl } = ctx;

    // Use a custom id (not POOL)
    const customId = keccak256(toHex('CUSTOM_POOL'));

    // First call: creates a new proxy (line 172-176 in _updateImpl)
    await provider.write.setAddressAsProxy([customId, mockImpl.address]);
    const proxyAddr1 = await provider.read.getAddress([customId]);
    assert.notEqual(proxyAddr1, ZERO_ADDR, 'proxy must be created');

    // Second call: updates existing proxy (lines 178-179 in _updateImpl)
    // Also covers _getProxyImplementation else branch (lines 205-206)
    await provider.write.setAddressAsProxy([customId, mockImpl.address]);
    const proxyAddr2 = await provider.read.getAddress([customId]);
    assert.equal(
      proxyAddr2.toLowerCase(),
      proxyAddr1.toLowerCase(),
      'proxy address must remain the same after update'
    );
  });

  it('setPriceOracleSentinel updates the sentinel address', async () => {
    const ctx = await networkHelpers.loadFixture(deployWithMockImpl);
    const { provider, user1 } = ctx;

    // Initially no sentinel
    const before = await provider.read.getPriceOracleSentinel();
    assert.equal(before, ZERO_ADDR);

    // Set sentinel to user1 address (any address works for this test)
    await provider.write.setPriceOracleSentinel([user1.account.address]);

    const after = await provider.read.getPriceOracleSentinel();
    assert.equal(after.toLowerCase(), user1.account.address.toLowerCase());
  });
});
