import { expect } from 'chai';
import { utils } from 'ethers';
import rawBRE from 'hardhat';
import { MAX_UINT_AMOUNT, oneEther } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { VariableDebtToken__factory, AToken__factory } from '@aave/deploy-v3';
import { makeSuite, TestEnv, initializeMakeSuite } from './helpers/make-suite';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { evmSnapshot, evmRevert, waitForTx } from '@aave/deploy-v3';

makeSuite('Pool Forced Liquidation', (testEnv: TestEnv) => {
  let snap: string;

  const { INVALID_HF } = ProtocolErrors;

  before(async () => {
    await rawBRE.deployments.fixture(['market']);
    await initializeMakeSuite();

    const { addressesProvider, oracle } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));
  });

  after(async () => {
    const { aaveOracle, addressesProvider } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(aaveOracle.address));
  });

  beforeEach(async () => {
    snap = await evmSnapshot();

    const { users, pool, usdc } = testEnv;
    const liquidator = users[1];
    const supplier = users[2];

    const supplied = await convertToCurrencyDecimals(usdc.address, '10000');
    await usdc.connect(supplier.signer)['mint(address,uint256)'](supplier.address, supplied);
    await usdc.connect(supplier.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(supplier.signer).supply(usdc.address, supplied, supplier.address, '0');

    const repayment = await convertToCurrencyDecimals(usdc.address, '10000');
    await usdc.connect(liquidator.signer)['mint(address,uint256)'](liquidator.address, repayment);
    await usdc.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);
  });

  afterEach(async () => {
    await evmRevert(snap);
  });

  it('Enable and disable forced liquidation on frozen reserve', async () => {
    const { configurator, usdc, poolAdmin, helpersContract } = testEnv;

    // Freeze USDC reserve first (prerequisite for forced liquidation)
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );

    // Enable forced liquidation for USDC
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    );

    const isEnabled = await helpersContract.getForcedLiquidationEnabled(usdc.address);
    expect(isEnabled).to.be.true;

    // Disable forced liquidation for USDC
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, false)
    );

    const isDisabled = await helpersContract.getForcedLiquidationEnabled(usdc.address);
    expect(isDisabled).to.be.false;
  });

  it('Unfreeze reserve with forced liquidation enabled will be reverted', async () => {
    const { configurator, usdc, poolAdmin } = testEnv;

    // Freeze USDC reserve first (prerequisite for forced liquidation)
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );

    // Enable forced liquidation for USDC
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    );

    // Attempt to unfreeze the reserve while forced liquidation is enabled - should revert
    await expect(
      configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, false)
    ).to.be.revertedWith('80'); // OPERATION_NOT_SUPPORTED
  });

  it('Enable forced liquidation on not frozen reserve will be reverted', async () => {
    const { configurator, usdc, poolAdmin } = testEnv;

    // Attempt to enable forced liquidation on non-frozen reserve - should revert
    await expect(
      configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    ).to.be.revertedWith('80'); // OPERATION_NOT_SUPPORTED
  });

  it('Manage forced liquidation whitelist', async () => {
    const { pool, users, poolAdmin } = testEnv;
    const user = users[0];

    // Add address to whitelist
    await waitForTx(
      await pool.connect(poolAdmin.signer).addToForcedLiquidationWhitelist(user.address)
    );
    expect(await pool.isInForcedLiquidationWhitelist(user.address)).to.be.true;

    // Remove address from whitelist
    await waitForTx(
      await pool.connect(poolAdmin.signer).removeFromForcedLiquidationWhitelist(user.address)
    );
    expect(await pool.isInForcedLiquidationWhitelist(user.address)).to.be.false;
  });

  it('Revert when enabling forced liquidation on non-frozen reserve', async () => {
    const { configurator, usdc, poolAdmin } = testEnv;

    // Attempt to enable forced liquidation on non-frozen reserve - should revert
    await expect(
      configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    ).to.be.revertedWith('80');

    // Attempt to disable forced liquidation on non-frozen reserve - should also revert
    await expect(
      configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, false)
    ).to.be.revertedWith('80');
  });

  it('Forced liquidation with health factor above threshold', async () => {
    const {
      weth,
      usdc,
      users: [user, liquidator],
      pool,
      configurator,
      poolAdmin,
    } = testEnv;

    // User supplies 10 WETH
    const amountToSupply = await convertToCurrencyDecimals(weth.address, '10');
    await weth.connect(user.signer)['mint(address,uint256)'](user.address, amountToSupply);
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(weth.address, amountToSupply, user.address, '0');

    // User borrows 5000 USDC
    const borrowAmount = await convertToCurrencyDecimals(usdc.address, '5000');
    await pool
      .connect(user.signer)
      .borrow(usdc.address, borrowAmount, RateMode.Variable, 0, user.address);

    const userGlobalData = await pool.getUserAccountData(user.address);
    // Expect health factor of user to be greater than 1
    expect(userGlobalData.healthFactor).to.be.gt(utils.parseUnits('1', 18), INVALID_HF);

    // Freeze USDC reserve first (prerequisite for forced liquidation)
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );
    // Enable forced liquidation for USDC
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    );
    // Add liquidator to whitelist
    await waitForTx(
      await pool.connect(poolAdmin.signer).addToForcedLiquidationWhitelist(liquidator.address)
    );

    // Get initial balances
    const wethData = await pool.getReserveData(weth.address);
    const aWETH = wethData.aTokenAddress;
    const aWETHContract = AToken__factory.connect(aWETH, user.signer);
    const userCollateralBefore = await aWETHContract.balanceOf(user.address);
    const liquidatorCollateralBefore = await weth.balanceOf(liquidator.address);

    // Attempt liquidation - should succeed with forced liquidation
    const liquidationTx = await pool
      .connect(liquidator.signer)
      .liquidationCall(weth.address, usdc.address, user.address, MAX_UINT_AMOUNT, false);

    // Verify liquidation occurred by checking debt reduction
    const usdcData = await pool.getReserveData(usdc.address);
    const variableDebtToken = VariableDebtToken__factory.connect(
      usdcData.variableDebtTokenAddress,
      user.signer
    );
    const remainingDebt = await variableDebtToken.balanceOf(user.address);
    expect(remainingDebt).to.be.eq(0);

    // Verify user collateral decreased
    const userCollateralAfter = await aWETHContract.balanceOf(user.address);
    expect(userCollateralAfter).to.be.lt(userCollateralBefore);

    // Verify liquidator received collateral
    const liquidatorCollateralAfter = await weth.balanceOf(liquidator.address);
    expect(liquidatorCollateralAfter).to.be.gt(liquidatorCollateralBefore);

    // Verify the collateral received by liquidator matches the collateral decreased from user
    const collateralLiquidated = userCollateralBefore.sub(userCollateralAfter);
    expect(liquidatorCollateralAfter.sub(liquidatorCollateralBefore)).to.be.eq(
      collateralLiquidated
    );

    // Verify collateral liquidated equals debtToCover * (1 + liquidationBonus)
    // Get liquidation bonus and prices
    const { helpersContract: helpers } = testEnv;
    const wethConfigFull = await helpers.getReserveConfigurationData(weth.address);
    const liquidationBonusFull = wethConfigFull.liquidationBonus;
    const wethPriceFull = await (await testEnv.aaveOracle).getAssetPrice(weth.address);
    const usdcPriceFull = await (await testEnv.aaveOracle).getAssetPrice(usdc.address);

    // debtToCover = borrowAmount = 5000 USDC
    const debtToCoverFull = borrowAmount;

    // Calculate expected collateral: debtToCover * (usdcPrice / wethPrice) * (1 + liquidationBonus/10000)
    const expectedCollateralFull = debtToCoverFull
      .mul(usdcPriceFull)
      .mul(utils.parseUnits('1', 18)) // WETH decimals
      .mul(liquidationBonusFull)
      .div(wethPriceFull)
      .div(utils.parseUnits('1', 6)) // USDC decimals
      .div(10000);

    expect(collateralLiquidated).to.be.closeTo(
      expectedCollateralFull,
      expectedCollateralFull.div(1000)
    );

    // Verify ForcedLiquidationCall event was emitted
    await expect(liquidationTx).to.emit(pool, 'ForcedLiquidationCall');
  });

  it('Partial forced liquidation with health factor above threshold', async () => {
    const {
      weth,
      usdc,
      users: [user, liquidator],
      pool,
      configurator,
      poolAdmin,
    } = testEnv;

    // User supplies 10 WETH
    const amountToSupply = await convertToCurrencyDecimals(weth.address, '10');
    await weth.connect(user.signer)['mint(address,uint256)'](user.address, amountToSupply);
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(weth.address, amountToSupply, user.address, '0');

    // User borrows 5000 USDC
    const borrowAmount = await convertToCurrencyDecimals(usdc.address, '5000');
    await pool
      .connect(user.signer)
      .borrow(usdc.address, borrowAmount, RateMode.Variable, 0, user.address);

    const userGlobalData = await pool.getUserAccountData(user.address);
    // Expect health factor of user to be greater than 1
    expect(userGlobalData.healthFactor).to.be.gt(oneEther, INVALID_HF);

    // Freeze USDC reserve first (prerequisite for forced liquidation)
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );
    // Enable forced liquidation for USDC
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    );
    // Add liquidator to whitelist
    await waitForTx(
      await pool.connect(poolAdmin.signer).addToForcedLiquidationWhitelist(liquidator.address)
    );

    // Get initial balances
    const wethData = await pool.getReserveData(weth.address);
    const aWETH = wethData.aTokenAddress;
    const aWETHContract = AToken__factory.connect(aWETH, user.signer);
    const userCollateralBefore = await aWETHContract.balanceOf(user.address);
    const liquidatorCollateralBefore = await weth.balanceOf(liquidator.address);

    const usdcData = await pool.getReserveData(usdc.address);
    const variableDebtToken = VariableDebtToken__factory.connect(
      usdcData.variableDebtTokenAddress,
      user.signer
    );
    const userDebtBefore = await variableDebtToken.balanceOf(user.address);

    // Partial liquidation - liquidate half of the debt (2500 USDC)
    const debtToCover = await convertToCurrencyDecimals(usdc.address, '2500');
    const liquidationTx = await pool
      .connect(liquidator.signer)
      .liquidationCall(weth.address, usdc.address, user.address, debtToCover, false);

    // Verify forced liquidation completed successfully
    await expect(liquidationTx).to.emit(pool, 'ForcedLiquidationCall');

    // Verify user debt reduced by half
    const userDebtAfter = await variableDebtToken.balanceOf(user.address);
    expect(userDebtAfter).to.be.closeTo(userDebtBefore.sub(debtToCover), 10);

    // Verify user collateral decreased
    const userCollateralAfter = await aWETHContract.balanceOf(user.address);
    expect(userCollateralAfter).to.be.lt(userCollateralBefore);

    // Verify liquidator received collateral
    const liquidatorCollateralAfter = await weth.balanceOf(liquidator.address);
    expect(liquidatorCollateralAfter).to.be.gt(liquidatorCollateralBefore);

    // Verify the collateral received by liquidator matches the collateral decreased from user
    const collateralLiquidated = userCollateralBefore.sub(userCollateralAfter);
    expect(liquidatorCollateralAfter.sub(liquidatorCollateralBefore)).to.be.eq(
      collateralLiquidated
    );

    // Verify collateral liquidated equals debtToCover * (1 + liquidationBonus)
    // Get liquidation bonus and prices
    const { helpersContract } = testEnv;
    const wethConfig = await helpersContract.getReserveConfigurationData(weth.address);
    const liquidationBonus = wethConfig.liquidationBonus;
    const wethPrice = await (await testEnv.aaveOracle).getAssetPrice(weth.address);
    const usdcPrice = await (await testEnv.aaveOracle).getAssetPrice(usdc.address);

    // Calculate expected collateral: debtToCover * (usdcPrice / wethPrice) * (1 + liquidationBonus/10000)
    const expectedCollateral = debtToCover
      .mul(usdcPrice)
      .mul(utils.parseUnits('1', 18)) // WETH decimals
      .mul(liquidationBonus)
      .div(wethPrice)
      .div(utils.parseUnits('1', 6)) // USDC decimals
      .div(10000);

    expect(collateralLiquidated).to.be.closeTo(expectedCollateral, expectedCollateral.div(1000)); // 0.1% tolerance
  });

  it('Forced liquidation fails without whitelist', async () => {
    const { pool, users, weth, usdc, poolAdmin, configurator } = testEnv;
    const user = users[0];
    const liquidator = users[1];

    // Create position with health factor > 1
    const wethAmount = await convertToCurrencyDecimals(weth.address, '10');
    await weth.connect(user.signer)['mint(address,uint256)'](user.address, wethAmount);
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(weth.address, wethAmount, user.address, 0);

    const usdcAmount = await convertToCurrencyDecimals(usdc.address, '5000');
    await pool
      .connect(user.signer)
      .borrow(usdc.address, usdcAmount, RateMode.Variable, 0, user.address);

    // Freeze USDC reserve first
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );
    // Enable forced liquidation for USDC but don't add to whitelist
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    );

    // Attempt liquidation without whitelist - should fail
    await expect(
      pool
        .connect(liquidator.signer)
        .liquidationCall(weth.address, usdc.address, user.address, MAX_UINT_AMOUNT, false)
    ).to.be.revertedWith('128'); // FORCED_LIQUIDATION_CALLER_NOT_AUTHORIZED
  });

  it('Forced liquidation fails when not enabled', async () => {
    const { pool, users, weth, usdc, poolAdmin, configurator } = testEnv;
    const user = users[0];
    const liquidator = users[1];

    // Create position with health factor > 1
    const wethAmount = await convertToCurrencyDecimals(weth.address, '10');
    await weth.connect(user.signer)['mint(address,uint256)'](user.address, wethAmount);
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(weth.address, wethAmount, user.address, 0);

    const usdcAmount = await convertToCurrencyDecimals(usdc.address, '5000');
    await pool
      .connect(user.signer)
      .borrow(usdc.address, usdcAmount, RateMode.Variable, 0, user.address);

    // Freeze USDC reserve after position setup
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );
    // Ensure forced liquidation is disabled
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, false)
    );

    // Verify health factor is above 1
    const userGlobalData = await pool.getUserAccountData(user.address);
    expect(userGlobalData.healthFactor).to.be.gt(oneEther);

    // Prepare liquidator with sufficient USDC funds for repayment
    const liquidateAmount = await convertToCurrencyDecimals(usdc.address, '100');
    await usdc
      .connect(liquidator.signer)
      ['mint(address,uint256)'](liquidator.address, liquidateAmount);
    await usdc.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    // Attempt liquidation - should fail with normal health factor check
    await expect(
      pool
        .connect(liquidator.signer)
        .liquidationCall(weth.address, usdc.address, user.address, liquidateAmount, false)
    ).to.be.revertedWith('45'); // HEALTH_FACTOR_NOT_BELOW_THRESHOLD
  });

  it('Forced liquidation still allows user to liquidate own position', async () => {
    const { pool, users, weth, usdc, poolAdmin, configurator } = testEnv;
    const user = users[0];

    // Create position with sufficient collateral
    const wethAmount = await convertToCurrencyDecimals(weth.address, '10');
    await weth.connect(user.signer)['mint(address,uint256)'](user.address, wethAmount);
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(weth.address, wethAmount, user.address, 0);

    const usdcAmount = await convertToCurrencyDecimals(usdc.address, '5000');
    await pool
      .connect(user.signer)
      .borrow(usdc.address, usdcAmount, RateMode.Variable, 0, user.address);

    // Freeze USDC reserve first
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );
    // Enable forced liquidation
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    );

    // Prepare repayment amount
    const repayment = await convertToCurrencyDecimals(usdc.address, '10000');
    await usdc.connect(user.signer)['mint(address,uint256)'](user.address, repayment);
    await usdc.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);

    // User should be able to liquidate their own position even without whitelist
    await pool
      .connect(user.signer)
      .liquidationCall(weth.address, usdc.address, user.address, MAX_UINT_AMOUNT, false);

    // Verify liquidation occurred
    const usdcData = await pool.getReserveData(usdc.address);
    const variableDebtToken = VariableDebtToken__factory.connect(
      usdcData.variableDebtTokenAddress,
      user.signer
    );
    const remainingDebt = await variableDebtToken.balanceOf(user.address);
    expect(remainingDebt).to.be.eq(0);
  });

  it('Forced liquidation allows full repay', async () => {
    const { pool, users, weth, usdc, poolAdmin, configurator } = testEnv;
    const user = users[0];
    const liquidator = users[1];

    // Create position with health factor > 1
    const wethAmount = await convertToCurrencyDecimals(weth.address, '10');
    await weth.connect(user.signer)['mint(address,uint256)'](user.address, wethAmount);
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(weth.address, wethAmount, user.address, 0);

    const usdcAmount = await convertToCurrencyDecimals(usdc.address, '5000');
    await pool
      .connect(user.signer)
      .borrow(usdc.address, usdcAmount, RateMode.Variable, 0, user.address);

    // Freeze USDC reserve first
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );
    // Enable forced liquidation for USDC
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    );
    // Add liquidator to whitelist
    await waitForTx(
      await pool.connect(poolAdmin.signer).addToForcedLiquidationWhitelist(liquidator.address)
    );

    // Verify health factor is above 1
    const userDataBefore = await pool.getUserAccountData(user.address);
    expect(userDataBefore.healthFactor).to.be.gt(oneEther);

    // Get debt before liquidation
    const usdcData = await pool.getReserveData(usdc.address);
    const variableDebtToken = VariableDebtToken__factory.connect(
      usdcData.variableDebtTokenAddress,
      user.signer
    );

    // Get initial balances
    const wethData = await pool.getReserveData(weth.address);
    const aWETH = wethData.aTokenAddress;
    const aWETHContract = AToken__factory.connect(aWETH, user.signer);
    const userCollateralBefore = await aWETHContract.balanceOf(user.address);
    const liquidatorCollateralBefore = await weth.balanceOf(liquidator.address);

    // Force liquidate with full repay
    const liquidationTx = await pool
      .connect(liquidator.signer)
      .liquidationCall(weth.address, usdc.address, user.address, MAX_UINT_AMOUNT, false);

    // Verify debt is fully repaid
    const debtAfter = await variableDebtToken.balanceOf(user.address);
    expect(debtAfter).to.equal(0);

    // Verify user collateral decreased
    const userCollateralAfter = await aWETHContract.balanceOf(user.address);
    expect(userCollateralAfter).to.be.lt(userCollateralBefore);

    // Verify liquidator received collateral
    const liquidatorCollateralAfter = await weth.balanceOf(liquidator.address);
    expect(liquidatorCollateralAfter).to.be.gt(liquidatorCollateralBefore);

    // Verify the collateral received by liquidator matches the collateral decreased from user
    const collateralLiquidated = userCollateralBefore.sub(userCollateralAfter);
    expect(liquidatorCollateralAfter.sub(liquidatorCollateralBefore)).to.be.eq(
      collateralLiquidated
    );

    // Verify health factor improved
    const userDataAfter = await pool.getUserAccountData(user.address);
    expect(userDataAfter.healthFactor).to.be.gte(userDataBefore.healthFactor);

    // Verify ForcedLiquidationCall event was emitted
    await expect(liquidationTx).to.emit(pool, 'ForcedLiquidationCall');
  });

  it('Emit both ForcedLiquidationCall and LiquidationCall events during forced liquidation', async () => {
    const { pool, users, weth, usdc, poolAdmin, configurator } = testEnv;
    const user = users[0];
    const liquidator = users[1];

    // Create position with sufficient collateral
    const wethAmount = await convertToCurrencyDecimals(weth.address, '10');
    await weth.connect(user.signer)['mint(address,uint256)'](user.address, wethAmount);
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(weth.address, wethAmount, user.address, 0);

    const usdcAmount = await convertToCurrencyDecimals(usdc.address, '5000');
    await pool
      .connect(user.signer)
      .borrow(usdc.address, usdcAmount, RateMode.Variable, 0, user.address);

    // Freeze USDC reserve first
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );

    // Enable forced liquidation for USDC
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    );

    // Add liquidator to whitelist
    await waitForTx(
      await pool.connect(poolAdmin.signer).addToForcedLiquidationWhitelist(liquidator.address)
    );

    // Test that both ForcedLiquidationCall and LiquidationCall events are emitted
    await expect(
      pool
        .connect(liquidator.signer)
        .liquidationCall(weth.address, usdc.address, user.address, MAX_UINT_AMOUNT, false)
    )
      .to.emit(pool, 'ForcedLiquidationCall')
      .and.to.emit(pool, 'LiquidationCall');
  });

  it('Emit only LiquidationCall event for normal liquidation (not forced)', async () => {
    const { pool, users, weth, usdc, oracle } = testEnv;
    const user = users[0];
    const liquidator = users[1];

    // Create position with health factor < 1 for normal liquidation
    const wethAmount = await convertToCurrencyDecimals(weth.address, '10');
    await weth.connect(user.signer)['mint(address,uint256)'](user.address, wethAmount);
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(weth.address, wethAmount, user.address, 0);

    const usdcAmount = await convertToCurrencyDecimals(usdc.address, '10000');
    await pool
      .connect(user.signer)
      .borrow(usdc.address, usdcAmount, RateMode.Variable, 0, user.address);

    // Reduce price to make health factor < 1
    const wethPrice = await oracle.getAssetPrice(weth.address);
    await waitForTx(await oracle.setAssetPrice(weth.address, wethPrice.mul(20).div(100)));

    // Verify health factor is below 1
    let userData = await pool.getUserAccountData(user.address);
    expect(userData.healthFactor).to.be.lt(oneEther);

    // Should only emit regular LiquidationCall event, not ForcedLiquidationCall
    await expect(
      pool
        .connect(liquidator.signer)
        .liquidationCall(weth.address, usdc.address, user.address, MAX_UINT_AMOUNT, false)
    )
      .to.emit(pool, 'LiquidationCall')
      .and.not.emit(pool, 'ForcedLiquidationCall');

    // Verify health factor is 0 after full liquidation
    userData = await pool.getUserAccountData(user.address);
    expect(userData.healthFactor).to.be.eq(0);
  });
});
