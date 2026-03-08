/**
 * E2E — PriceOracleSentinel
 *
 * Covers:
 *   - Constructor (lines 52-54)
 *   - isBorrowAllowed / isLiquidationAllowed (lines 59, 64)
 *   - _isUpAndGracePeriodPassed (lines 72-73)
 *   - setSequencerOracle (lines 78-79)
 *   - setGracePeriod (lines 84-85)
 *   - getSequencerOracle, getGracePeriod (lines 90, 95)
 *   - onlyPoolAdmin modifier (lines 22-24)
 *   - onlyRiskOrPoolAdmins modifier (lines 31-36)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

const GRACE_PERIOD = 3600n; // 1 hour

describe('E2E: PriceOracleSentinel', () => {
  async function deploySentinelFixture({ viem }: any) {
    const base = await deployMarket({ viem });
    const { provider, deployer } = base;

    // Deploy SequencerOracle mock — starts "up" (isDown=false) with timestampGotUp = now
    const sequencerOracle = await viem.deployContract('SequencerOracle', [
      deployer.account.address,
    ]);
    const block = await viem.getPublicClient().then((c: any) => c.getBlock());
    await sequencerOracle.write.setAnswer([false, block.timestamp]);

    const sentinel = await viem.deployContract('PriceOracleSentinel', [
      provider.address,
      sequencerOracle.address,
      GRACE_PERIOD,
    ]);

    return { ...base, sentinel, sequencerOracle };
  }

  it('constructor sets ADDRESSES_PROVIDER, sequencer oracle, and grace period', async () => {
    const ctx = await networkHelpers.loadFixture(deploySentinelFixture);
    const { sentinel, provider, sequencerOracle } = ctx;

    assert.equal(
      (await sentinel.read.ADDRESSES_PROVIDER()).toLowerCase(),
      provider.address.toLowerCase()
    );
    assert.equal(
      (await sentinel.read.getSequencerOracle()).toLowerCase(),
      sequencerOracle.address.toLowerCase()
    );
    assert.equal(await sentinel.read.getGracePeriod(), GRACE_PERIOD);
  });

  it('isBorrowAllowed returns true when sequencer up and grace period passed', async () => {
    const ctx = await networkHelpers.loadFixture(deploySentinelFixture);
    const { sentinel } = ctx;

    // Advance past grace period
    await networkHelpers.time.increase(Number(GRACE_PERIOD) + 1);

    assert.equal(await sentinel.read.isBorrowAllowed(), true);
  });

  it('isLiquidationAllowed returns true when sequencer up and grace period passed', async () => {
    const ctx = await networkHelpers.loadFixture(deploySentinelFixture);
    const { sentinel } = ctx;

    await networkHelpers.time.increase(Number(GRACE_PERIOD) + 1);

    assert.equal(await sentinel.read.isLiquidationAllowed(), true);
  });

  it('isBorrowAllowed returns false when sequencer is down', async () => {
    const ctx = await networkHelpers.loadFixture(deploySentinelFixture);
    const { sentinel, sequencerOracle } = ctx;
    const { viem } = await network.connect();

    const block = await viem.getPublicClient().then((c: any) => c.getBlock());
    await sequencerOracle.write.setAnswer([true, block.timestamp]); // down

    assert.equal(await sentinel.read.isBorrowAllowed(), false);
  });

  it('isBorrowAllowed returns false during grace period', async () => {
    const ctx = await networkHelpers.loadFixture(deploySentinelFixture);
    const { sentinel } = ctx;

    // Don't advance time — still within grace period
    assert.equal(await sentinel.read.isBorrowAllowed(), false);
  });

  it('setSequencerOracle updates oracle (pool admin)', async () => {
    const ctx = await networkHelpers.loadFixture(deploySentinelFixture);
    const { viem } = await network.connect();
    const { sentinel, deployer } = ctx;

    const newOracle = await viem.deployContract('SequencerOracle', [deployer.account.address]);
    await sentinel.write.setSequencerOracle([newOracle.address]);

    assert.equal(
      (await sentinel.read.getSequencerOracle()).toLowerCase(),
      newOracle.address.toLowerCase()
    );
  });

  it('setGracePeriod updates grace period (risk or pool admin)', async () => {
    const ctx = await networkHelpers.loadFixture(deploySentinelFixture);
    const { sentinel } = ctx;

    await sentinel.write.setGracePeriod([7200n]);

    assert.equal(await sentinel.read.getGracePeriod(), 7200n);
  });

  it('setSequencerOracle reverts for non-admin', async () => {
    const ctx = await networkHelpers.loadFixture(deploySentinelFixture);
    const { sentinel, user1 } = ctx;

    await assert.rejects(
      sentinel.write.setSequencerOracle([user1.account.address], { account: user1.account }),
      'non-pool-admin must revert'
    );
  });

  it('setGracePeriod reverts for non-admin', async () => {
    const ctx = await networkHelpers.loadFixture(deploySentinelFixture);
    const { sentinel, user1 } = ctx;

    await assert.rejects(
      sentinel.write.setGracePeriod([100n], { account: user1.account }),
      'non-risk/pool-admin must revert'
    );
  });
});
