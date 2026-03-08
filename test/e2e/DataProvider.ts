/**
 * E2E — AaveProtocolDataProvider
 *
 * Covers all uncovered view functions:
 *   - getAllReservesTokens (lines 41-58)
 *   - getAllATokens (lines 63-73)
 *   - getReserveConfigurationData (lines 96-104)
 *   - getReserveEModeCategory (lines 109-111)
 *   - getReserveCaps (line 118)
 *   - getPaused (line 123)
 *   - getSiloedBorrowing (line 128)
 *   - getLiquidationProtocolFee (line 133)
 *   - getUnbackedMintCap (line 138)
 *   - getDebtCeiling (line 143)
 *   - getDebtCeilingDecimals (line 148)
 *   - getATokenTotalSupply (lines 195-198)
 *   - getInterestRateStrategyAddress (lines 279-283)
 *   - getFlashLoanEnabled (lines 288-291)
 *   - getForcedLiquidationEnabled (lines 296-299)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { deployMarket, WAD } from '../helpers/deployMarket.js';

const { networkHelpers } = await network.connect();

describe('E2E: AaveProtocolDataProvider', () => {
  it('getAllReservesTokens returns all reserve symbols and addresses', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth, usdc, dai } = ctx;

    const tokens = await dataProvider.read.getAllReservesTokens();
    assert.equal(tokens.length, 3);

    const symbols = tokens.map((t: any) => t.symbol);
    assert.ok(symbols.includes('WETH'));
    assert.ok(symbols.includes('USDC'));
    assert.ok(symbols.includes('DAI'));

    const addrs = tokens.map((t: any) => t.tokenAddress.toLowerCase());
    assert.ok(addrs.includes(weth.address.toLowerCase()));
    assert.ok(addrs.includes(usdc.address.toLowerCase()));
    assert.ok(addrs.includes(dai.address.toLowerCase()));
  });

  it('getAllATokens returns all aToken symbols and addresses', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, aWeth, aUsdc, aDai } = ctx;

    const aTokens = await dataProvider.read.getAllATokens();
    assert.equal(aTokens.length, 3);

    const addrs = aTokens.map((t: any) => t.tokenAddress.toLowerCase());
    assert.ok(addrs.includes(aWeth.address.toLowerCase()));
    assert.ok(addrs.includes(aUsdc.address.toLowerCase()));
    assert.ok(addrs.includes(aDai.address.toLowerCase()));
  });

  it('getReserveConfigurationData returns correct params and flags', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    const data = await dataProvider.read.getReserveConfigurationData([weth.address]);
    // WETH: 18 decimals, ltv=8000, threshold=8500, bonus=10500
    assert.equal(data[0], 18n); // decimals
    assert.equal(data[1], 8000n); // ltv
    assert.equal(data[2], 8500n); // liquidationThreshold
    assert.equal(data[3], 10500n); // liquidationBonus
    assert.equal(data[5], true); // usageAsCollateralEnabled (threshold != 0)
    assert.equal(data[6], true); // borrowingEnabled
    assert.equal(data[8], true); // isActive
    assert.equal(data[9], false); // isFrozen
  });

  it('getReserveEModeCategory returns 0 by default', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    const cat = await dataProvider.read.getReserveEModeCategory([weth.address]);
    assert.equal(cat, 0n);
  });

  it('getReserveCaps returns (0, 0) by default', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    const [borrowCap, supplyCap] = await dataProvider.read.getReserveCaps([weth.address]);
    assert.equal(borrowCap, 0n);
    assert.equal(supplyCap, 0n);
  });

  it('getReserveCaps returns configured caps', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, poolConfigurator, weth } = ctx;

    await poolConfigurator.write.setBorrowCap([weth.address, 1000n]);
    await poolConfigurator.write.setSupplyCap([weth.address, 5000n]);

    const [borrowCap, supplyCap] = await dataProvider.read.getReserveCaps([weth.address]);
    assert.equal(borrowCap, 1000n);
    assert.equal(supplyCap, 5000n);
  });

  it('getPaused returns false by default', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    assert.equal(await dataProvider.read.getPaused([weth.address]), false);
  });

  it('getPaused returns true after pause', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, poolConfigurator, weth } = ctx;

    await poolConfigurator.write.setReservePause([weth.address, true]);
    assert.equal(await dataProvider.read.getPaused([weth.address]), true);
  });

  it('getSiloedBorrowing returns false by default', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    assert.equal(await dataProvider.read.getSiloedBorrowing([weth.address]), false);
  });

  it('getLiquidationProtocolFee returns 0 by default', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    assert.equal(await dataProvider.read.getLiquidationProtocolFee([weth.address]), 0n);
  });

  it('getUnbackedMintCap returns 0 by default', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    assert.equal(await dataProvider.read.getUnbackedMintCap([weth.address]), 0n);
  });

  it('getDebtCeiling returns 0 by default', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    assert.equal(await dataProvider.read.getDebtCeiling([weth.address]), 0n);
  });

  it('getDebtCeilingDecimals returns 2', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider } = ctx;

    assert.equal(await dataProvider.read.getDebtCeilingDecimals(), 2n);
  });

  it('getATokenTotalSupply returns total supply after deposit', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, pool, weth, user1 } = ctx;

    await weth.write.mint([user1.account.address, 10n * WAD]);
    await weth.write.approve([pool.address, 10n * WAD], { account: user1.account });
    await pool.write.supply([weth.address, 10n * WAD, user1.account.address, 0], {
      account: user1.account,
    });

    const totalSupply = await dataProvider.read.getATokenTotalSupply([weth.address]);
    assert.equal(totalSupply, 10n * WAD);
  });

  it('getInterestRateStrategyAddress returns non-zero address', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    const strategy = await dataProvider.read.getInterestRateStrategyAddress([weth.address]);
    assert.notEqual(strategy, '0x0000000000000000000000000000000000000000');
  });

  it('getFlashLoanEnabled returns true (enabled in fixture)', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    assert.equal(await dataProvider.read.getFlashLoanEnabled([weth.address]), true);
  });

  it('getForcedLiquidationEnabled returns false by default', async () => {
    const ctx = await networkHelpers.loadFixture(deployMarket);
    const { dataProvider, weth } = ctx;

    assert.equal(await dataProvider.read.getForcedLiquidationEnabled([weth.address]), false);
  });
});
