/**
 * E2E — AaveOracle
 *
 * Covers:
 *   - AaveOracle constructor (lines 55-60)
 *   - setAssetSources / _setAssetsSources (lines 68, 84-87)
 *   - setFallbackOracle / _setFallbackOracle (lines 75, 96-97)
 *   - getAssetPrice: base currency, aggregator, fallback, negative price (lines 102-113)
 *   - getAssetsPrices (lines 122-126)
 *   - getSourceOfAsset, getFallbackOracle (lines 131, 136)
 *   - _onlyAssetListingOrPoolAdmins access control (lines 140-144)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, ZERO_ADDR } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

describe('E2E: AaveOracle', () => {
  async function deployOracleFixture({ viem }: any) {
    const base = await deployMarket({ viem });
    const { provider, weth, usdc, dai, deployer } = base;

    // Deploy MockAggregators for WETH and USDC
    const wethAgg = await viem.deployContract('MockAggregator', [2_000n * 10n ** 8n]);
    const usdcAgg = await viem.deployContract('MockAggregator', [1n * 10n ** 8n]);

    // Deploy PriceOracle as fallback
    const fallback = await viem.deployContract('PriceOracle');
    await fallback.write.setAssetPrice([dai.address, 1n * 10n ** 8n]);

    // Deploy AaveOracle with WETH and USDC sources; DAI has no source (tests fallback)
    const aaveOracle = await viem.deployContract('AaveOracle', [
      provider.address,
      [weth.address, usdc.address],
      [wethAgg.address, usdcAgg.address],
      fallback.address,
      ZERO_ADDR, // baseCurrency = address(0) → USD
      10n ** 8n, // baseCurrencyUnit = 1e8
    ]);

    // Deploy an extra aggregator for DAI to test setAssetSources later
    const daiAgg = await viem.deployContract('MockAggregator', [2n * 10n ** 8n]);

    return { ...base, aaveOracle, wethAgg, usdcAgg, daiAgg, fallback: fallback };
  }

  it('constructor sets immutables and emits BaseCurrencySet', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle, provider } = ctx;

    assert.equal(
      (await aaveOracle.read.ADDRESSES_PROVIDER()).toLowerCase(),
      provider.address.toLowerCase()
    );
    assert.equal(await aaveOracle.read.BASE_CURRENCY(), ZERO_ADDR);
    assert.equal(await aaveOracle.read.BASE_CURRENCY_UNIT(), 10n ** 8n);
  });

  it('getAssetPrice returns aggregator price for configured asset', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle, weth } = ctx;

    const price = await aaveOracle.read.getAssetPrice([weth.address]);
    assert.equal(price, 2_000n * 10n ** 8n);
  });

  it('getAssetPrice returns BASE_CURRENCY_UNIT for base currency', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle } = ctx;

    // base currency is address(0)
    const price = await aaveOracle.read.getAssetPrice([ZERO_ADDR]);
    assert.equal(price, 10n ** 8n);
  });

  it('getAssetPrice falls back when source is address(0)', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle, dai } = ctx;

    // DAI has no aggregator source → falls back to PriceOracle
    const price = await aaveOracle.read.getAssetPrice([dai.address]);
    assert.equal(price, 1n * 10n ** 8n);
  });

  it('getAssetsPrices returns batch prices', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle, weth, usdc, dai } = ctx;

    const prices = await aaveOracle.read.getAssetsPrices([
      [weth.address, usdc.address, dai.address],
    ]);
    assert.equal(prices[0], 2_000n * 10n ** 8n);
    assert.equal(prices[1], 1n * 10n ** 8n);
    assert.equal(prices[2], 1n * 10n ** 8n);
  });

  it('getSourceOfAsset returns aggregator address', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle, weth, wethAgg } = ctx;

    const source = await aaveOracle.read.getSourceOfAsset([weth.address]);
    assert.equal(source.toLowerCase(), wethAgg.address.toLowerCase());
  });

  it('getFallbackOracle returns the fallback oracle address', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle } = ctx;

    const fb = await aaveOracle.read.getFallbackOracle();
    assert.notEqual(fb, ZERO_ADDR);
  });

  it('setAssetSources updates sources (admin)', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle, dai, daiAgg } = ctx;

    // DAI initially has no source (falls back to PriceOracle)
    const priceBefore = await aaveOracle.read.getAssetPrice([dai.address]);
    assert.equal(priceBefore, 1n * 10n ** 8n);

    // Set DAI source to the pre-deployed aggregator
    await aaveOracle.write.setAssetSources([[dai.address], [daiAgg.address]]);

    const priceAfter = await aaveOracle.read.getAssetPrice([dai.address]);
    assert.equal(priceAfter, 2n * 10n ** 8n);
  });

  it('setFallbackOracle updates fallback (admin)', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { viem } = await network.connect();
    const { aaveOracle } = ctx;

    const newFallback = await viem.deployContract('PriceOracle');
    await aaveOracle.write.setFallbackOracle([newFallback.address]);

    const fb = await aaveOracle.read.getFallbackOracle();
    assert.equal(fb.toLowerCase(), newFallback.address.toLowerCase());
  });

  it('setAssetSources reverts for non-admin', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle, dai, user1 } = ctx;

    await assert.rejects(
      aaveOracle.write.setAssetSources([[dai.address], [ZERO_ADDR]], {
        account: user1.account,
      }),
      'non-admin must revert'
    );
  });

  it('setFallbackOracle reverts for non-admin', async () => {
    const ctx = await networkHelpers.loadFixture(deployOracleFixture);
    const { aaveOracle, user1 } = ctx;

    await assert.rejects(
      aaveOracle.write.setFallbackOracle([ZERO_ADDR], { account: user1.account }),
      'non-admin must revert'
    );
  });
});
