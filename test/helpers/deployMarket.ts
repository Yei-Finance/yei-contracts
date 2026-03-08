/**
 * deployMarket — full Aave-fork market deployment fixture
 *
 * Deployment sequence:
 *  1. PoolAddressesProvider
 *  2. ACLManager (needs ACL admin set first)
 *  3. Pool impl → proxy via setPoolImpl
 *  4. PoolConfigurator impl → proxy via setPoolConfiguratorImpl
 *  5. AToken / StableDebtToken / VariableDebtToken impls
 *  6. PriceOracle mock
 *  7. MintableERC20 assets: WETH (18), USDC (6), DAI (18)
 *  8. DefaultReserveInterestRateStrategy per asset
 *  9. initReserves + configureReserveAsCollateral + setReserveBorrowing
 * 10. setReserveFlashLoaning enabled on all reserves
 */
export const RAY = 10n ** 27n;
export const WAD = 10n ** 18n;
export const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;
export const VARIABLE_RATE_MODE = 2n;

// deployMarket accepts the connection from loadFixture so that snapshot/restore
// works correctly (uses the same provider as the networkHelpers that takes snapshots).
export async function deployMarket({ viem }: any) {
  const [deployer, user1, user2, liquidator] = await viem.getWalletClients();

  const OWNER = deployer.account.address;
  const TREASURY = deployer.account.address;

  // ── 1. PoolAddressesProvider ────────────────────────────────────────────────
  const provider = await viem.deployContract('PoolAddressesProvider', ['MAIN_MARKET', OWNER]);

  // ── 2. ACLManager (provider needs ACL_ADMIN set before deploy) ──────────────
  await provider.write.setACLAdmin([OWNER]);
  const aclManager = await viem.deployContract('ACLManager', [provider.address]);
  await provider.write.setACLManager([aclManager.address]);

  // Grant operational roles to deployer
  await aclManager.write.addPoolAdmin([OWNER]);
  await aclManager.write.addAssetListingAdmin([OWNER]);
  await aclManager.write.addRiskAdmin([OWNER]);
  await aclManager.write.addEmergencyAdmin([OWNER]);

  // ── 3. Deploy logic libraries (Pool uses external linking) ─────────────────
  // Order matters: libs that depend on each other must be deployed first
  const borrowLogic = await viem.deployContract('BorrowLogic');
  const bridgeLogic = await viem.deployContract('BridgeLogic');
  const eModeLogic = await viem.deployContract('EModeLogic');
  const poolLogic = await viem.deployContract('PoolLogic');
  const supplyLogic = await viem.deployContract('SupplyLogic');

  // FlashLoanLogic depends on BorrowLogic
  const flashLoanLogic = await viem.deployContract('FlashLoanLogic', [], {
    libraries: { BorrowLogic: borrowLogic.address },
  });

  // LiquidationLogic uses EModeLogic only for internal functions (inlined)
  const liquidationLogic = await viem.deployContract('LiquidationLogic');

  const configuratorLogic = await viem.deployContract('ConfiguratorLogic');

  const poolLibraries = {
    BorrowLogic: borrowLogic.address,
    BridgeLogic: bridgeLogic.address,
    EModeLogic: eModeLogic.address,
    FlashLoanLogic: flashLoanLogic.address,
    LiquidationLogic: liquidationLogic.address,
    PoolLogic: poolLogic.address,
    SupplyLogic: supplyLogic.address,
  };

  // ── 4. Pool proxy ───────────────────────────────────────────────────────────
  const poolImpl = await viem.deployContract('Pool', [provider.address], {
    libraries: poolLibraries,
  });
  await provider.write.setPoolImpl([poolImpl.address]);
  const pool = await viem.getContractAt('Pool', await provider.read.getPool());

  // ── 5. PoolConfigurator proxy ───────────────────────────────────────────────
  const poolConfiguratorImpl = await viem.deployContract('PoolConfigurator', [], {
    libraries: { ConfiguratorLogic: configuratorLogic.address },
  });
  await provider.write.setPoolConfiguratorImpl([poolConfiguratorImpl.address]);
  const poolConfigurator = await viem.getContractAt(
    'PoolConfigurator',
    await provider.read.getPoolConfigurator()
  );

  // ── 6. Token implementations ────────────────────────────────────────────────
  const aTokenImpl = await viem.deployContract('AToken', [pool.address]);
  const stableDebtImpl = await viem.deployContract('StableDebtToken', [pool.address]);
  const varDebtImpl = await viem.deployContract('VariableDebtToken', [pool.address]);

  // ── 6. PriceOracle ──────────────────────────────────────────────────────────
  const oracle = await viem.deployContract('PriceOracle');
  await provider.write.setPriceOracle([oracle.address]);

  // ── 7. Test tokens ──────────────────────────────────────────────────────────
  const weth = await viem.deployContract('MintableERC20', ['Wrapped Ether', 'WETH', 18]);
  const usdc = await viem.deployContract('MintableERC20', ['USD Coin', 'USDC', 6]);
  const dai = await viem.deployContract('MintableERC20', ['Dai Stablecoin', 'DAI', 18]);

  // Prices: 8 decimal USD denomination
  await oracle.write.setAssetPrice([weth.address, 2_000n * 10n ** 8n]); // $2,000
  await oracle.write.setAssetPrice([usdc.address, 1n * 10n ** 8n]); // $1.00
  await oracle.write.setAssetPrice([dai.address, 1n * 10n ** 8n]); // $1.00

  // ── 8. Interest rate strategies ─────────────────────────────────────────────
  const OPT_80 = (80n * RAY) / 100n;
  const OPT_90 = (90n * RAY) / 100n;
  const SLOPE1 = (4n * RAY) / 100n; // 4%
  const SLOPE2 = (75n * RAY) / 100n; // 75%
  const S_SLOPE1 = (5n * RAY) / 1000n; // 0.5%
  const S_SLOPE2 = (60n * RAY) / 100n; // 60%
  const S_OFFSET = (1n * RAY) / 100n; // 1%
  const S_EXCESS = (8n * RAY) / 100n; // 8%
  const S_OPT_RATIO = (20n * RAY) / 100n; // 20%

  const wethStrategy = await viem.deployContract('DefaultReserveInterestRateStrategy', [
    provider.address,
    OPT_80,
    0n,
    SLOPE1,
    SLOPE2,
    S_SLOPE1,
    S_SLOPE2,
    S_OFFSET,
    S_EXCESS,
    S_OPT_RATIO,
  ]);
  const stableStrategy = await viem.deployContract('DefaultReserveInterestRateStrategy', [
    provider.address,
    OPT_90,
    0n,
    SLOPE1,
    S_SLOPE2,
    S_SLOPE1,
    S_SLOPE2,
    S_OFFSET,
    S_EXCESS,
    S_OPT_RATIO,
  ]);

  // ── 9. Init reserves ────────────────────────────────────────────────────────
  const makeReserveInput = (
    underlying: `0x${string}`,
    decimals: number,
    strategy: `0x${string}`,
    symbol: string
  ) => ({
    aTokenImpl: aTokenImpl.address,
    stableDebtTokenImpl: stableDebtImpl.address,
    variableDebtTokenImpl: varDebtImpl.address,
    underlyingAssetDecimals: decimals,
    interestRateStrategyAddress: strategy,
    underlyingAsset: underlying,
    treasury: TREASURY,
    incentivesController: ZERO_ADDR,
    aTokenName: `Aave ${symbol}`,
    aTokenSymbol: `a${symbol}`,
    variableDebtTokenName: `Variable Debt ${symbol}`,
    variableDebtTokenSymbol: `variableDebt${symbol}`,
    stableDebtTokenName: `Stable Debt ${symbol}`,
    stableDebtTokenSymbol: `stableDebt${symbol}`,
    params: '0x' as `0x${string}`,
  });

  await poolConfigurator.write.initReserves([
    [
      makeReserveInput(weth.address, 18, wethStrategy.address, 'WETH'),
      makeReserveInput(usdc.address, 6, stableStrategy.address, 'USDC'),
      makeReserveInput(dai.address, 18, stableStrategy.address, 'DAI'),
    ],
  ]);

  // Collateral config: (asset, ltv, liquidationThreshold, liquidationBonus)
  await poolConfigurator.write.configureReserveAsCollateral([weth.address, 8000n, 8500n, 10500n]);
  await poolConfigurator.write.setReserveBorrowing([weth.address, true]);

  await poolConfigurator.write.configureReserveAsCollateral([usdc.address, 7500n, 8000n, 10500n]);
  await poolConfigurator.write.setReserveBorrowing([usdc.address, true]);

  await poolConfigurator.write.configureReserveAsCollateral([dai.address, 7500n, 8000n, 10500n]);
  await poolConfigurator.write.setReserveBorrowing([dai.address, true]);

  // Enable flash loans on all reserves
  await poolConfigurator.write.setReserveFlashLoaning([weth.address, true]);
  await poolConfigurator.write.setReserveFlashLoaning([usdc.address, true]);
  await poolConfigurator.write.setReserveFlashLoaning([dai.address, true]);

  // ── 10. AaveProtocolDataProvider ────────────────────────────────────────────
  // Required by PoolConfigurator._checkNoSuppliers (setReserveActive, setSiloedBorrowing,
  // setDebtCeiling, dropReserve).
  const dataProvider = await viem.deployContract('AaveProtocolDataProvider', [provider.address]);
  await provider.write.setPoolDataProvider([dataProvider.address]);

  // ── 11. Resolve token proxies ───────────────────────────────────────────────
  const wethReserve = await pool.read.getReserveData([weth.address]);
  const usdcReserve = await pool.read.getReserveData([usdc.address]);
  const daiReserve = await pool.read.getReserveData([dai.address]);

  const aWeth = await viem.getContractAt('AToken', wethReserve.aTokenAddress);
  const aUsdc = await viem.getContractAt('AToken', usdcReserve.aTokenAddress);
  const aDai = await viem.getContractAt('AToken', daiReserve.aTokenAddress);

  const varDebtWeth = await viem.getContractAt(
    'VariableDebtToken',
    wethReserve.variableDebtTokenAddress
  );
  const varDebtUsdc = await viem.getContractAt(
    'VariableDebtToken',
    usdcReserve.variableDebtTokenAddress
  );
  const varDebtDai = await viem.getContractAt(
    'VariableDebtToken',
    daiReserve.variableDebtTokenAddress
  );

  const stableDebtWeth = await viem.getContractAt(
    'StableDebtToken',
    wethReserve.stableDebtTokenAddress
  );
  const stableDebtUsdc = await viem.getContractAt(
    'StableDebtToken',
    usdcReserve.stableDebtTokenAddress
  );
  const stableDebtDai = await viem.getContractAt(
    'StableDebtToken',
    daiReserve.stableDebtTokenAddress
  );

  return {
    provider,
    pool,
    poolConfigurator,
    aclManager,
    oracle,
    dataProvider,
    weth,
    usdc,
    dai,
    wethStrategy,
    stableStrategy,
    aTokenImpl,
    stableDebtImpl,
    varDebtImpl,
    aWeth,
    aUsdc,
    aDai,
    varDebtWeth,
    varDebtUsdc,
    varDebtDai,
    stableDebtWeth,
    stableDebtUsdc,
    stableDebtDai,
    deployer,
    user1,
    user2,
    liquidator,
    OWNER,
    TREASURY,
    ZERO_ADDR,
  };
}
