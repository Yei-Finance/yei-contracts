/**
 * E2E — Token Implementation Upgrades
 *
 * Covers:
 *   - ConfiguratorLogic lines 130-153: executeUpdateAToken
 *   - ConfiguratorLogic lines 161-190: executeUpdateStableDebtToken
 *   - ConfiguratorLogic lines 199-219: executeUpdateVariableDebtToken
 *   - PoolConfigurator lines 101, 108, 115: updateAToken/updateStableDebtToken/updateVariableDebtToken
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, ZERO_ADDR } from '../helpers/deployMarket.js';

const { networkHelpers, viem } = await network.connect();

describe('E2E: Token Implementation Upgrades', () => {
  describe('updateAToken()', () => {
    it('upgrades the aToken implementation (re-initializes proxy)', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth, aWeth, aTokenImpl, TREASURY } = ctx;

      // Deploy a higher-revision AToken implementation (rev 3 > current rev 2 → re-init succeeds)
      const newATokenImpl = await viem.deployContract('MockATokenV3', [pool.address]);

      // Upgrade — should not revert
      await poolConfigurator.write.updateAToken([
        {
          asset: weth.address,
          treasury: TREASURY as `0x${string}`,
          incentivesController: ZERO_ADDR,
          name: 'Aave WETH v2',
          symbol: 'aWETHv2',
          implementation: newATokenImpl.address,
          params: '0x' as `0x${string}`,
        },
      ]);

      // The proxy address remains the same (upgrade is in-place)
      const wethReserve = await pool.read.getReserveData([weth.address]);
      assert.equal(
        wethReserve.aTokenAddress.toLowerCase(),
        aWeth.address.toLowerCase(),
        'proxy address must be unchanged'
      );

      // Verify the new implementation is live: the proxy was re-initialized with the new symbol
      const upgradedAToken = await viem.getContractAt('AToken', aWeth.address);
      assert.equal(
        await upgradedAToken.read.symbol(),
        'aWETHv2',
        'upgraded aToken must have new symbol'
      );
    });
  });

  describe('updateStableDebtToken()', () => {
    it('upgrades the stable debt token implementation: proxy address unchanged, impl changed', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth, stableDebtWeth } = ctx;

      // Record old proxy address
      const wethReserveBefore = await pool.read.getReserveData([weth.address]);
      const proxyAddr = wethReserveBefore.stableDebtTokenAddress;

      // Higher revision (2 > current 1) so re-initialization succeeds
      const newStableImpl = await viem.deployContract('MockStableDebtTokenV2', [pool.address]);

      await poolConfigurator.write.updateStableDebtToken([
        {
          asset: weth.address,
          incentivesController: ZERO_ADDR,
          name: 'Stable Debt WETH v2',
          symbol: 'stableDebtWETHv2',
          implementation: newStableImpl.address,
          params: '0x' as `0x${string}`,
        },
      ]);

      // Proxy address is unchanged after upgrade
      const wethReserveAfter = await pool.read.getReserveData([weth.address]);
      assert.equal(
        wethReserveAfter.stableDebtTokenAddress.toLowerCase(),
        proxyAddr.toLowerCase(),
        'proxy address must not change during upgrade'
      );

      // Verify the new implementation is live: the proxy was re-initialized with the new symbol
      const upgradedToken = await viem.getContractAt('StableDebtToken', proxyAddr as `0x${string}`);
      assert.equal(
        await upgradedToken.read.symbol(),
        'stableDebtWETHv2',
        'upgraded token must have new symbol'
      );
    });
  });

  describe('updateVariableDebtToken()', () => {
    it('upgrades the variable debt token implementation', async () => {
      const ctx = await networkHelpers.loadFixture(deployMarket);
      const { poolConfigurator, pool, weth, varDebtWeth } = ctx;

      // Higher revision (2 > current 1) so re-initialization succeeds
      const newVarImpl = await viem.deployContract('MockVariableDebtTokenV2', [pool.address]);

      await poolConfigurator.write.updateVariableDebtToken([
        {
          asset: weth.address,
          incentivesController: ZERO_ADDR,
          name: 'Variable Debt WETH v2',
          symbol: 'variableDebtWETHv2',
          implementation: newVarImpl.address,
          params: '0x' as `0x${string}`,
        },
      ]);

      // Proxy address unchanged after upgrade
      const wethReserve = await pool.read.getReserveData([weth.address]);
      assert.equal(
        wethReserve.variableDebtTokenAddress.toLowerCase(),
        varDebtWeth.address.toLowerCase(),
        'proxy address must be unchanged after variable debt token upgrade'
      );

      // Verify the new implementation is live: the proxy was re-initialized with the new symbol
      const upgradedVDebt = await viem.getContractAt('VariableDebtToken', varDebtWeth.address);
      assert.equal(
        await upgradedVDebt.read.symbol(),
        'variableDebtWETHv2',
        'upgraded variable debt token must have new symbol'
      );
    });
  });
});
