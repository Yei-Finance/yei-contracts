import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';

const { viem } = await network.connect();

describe('PoolConfigurator deployment', () => {
  it('deploys PoolConfigurator at a valid non-zero address', async () => {
    const configuratorLogic = await viem.deployContract('ConfiguratorLogic');
    const poolConfig = await viem.deployContract('PoolConfigurator', [], {
      libraries: { ConfiguratorLogic: configuratorLogic.address },
    });

    assert.ok(
      poolConfig.address !== '0x0000000000000000000000000000000000000000',
      'PoolConfigurator must be deployed at a non-zero address'
    );

    // Verify the deployed contract has the expected interface
    // CONFIGURATOR_REVISION = 0x2 per PoolConfigurator.sol
    const revision = await poolConfig.read.CONFIGURATOR_REVISION();
    assert.equal(revision, 2n, 'PoolConfigurator revision must be 2');
  });
});
