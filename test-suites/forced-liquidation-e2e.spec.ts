import { expect } from 'chai';
import { BigNumber, constants } from 'ethers';
import rawBRE from 'hardhat';
import { MAX_UINT_AMOUNT, oneEther } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { VariableDebtToken__factory } from '@aave/deploy-v3';
import { makeSuite, TestEnv, initializeMakeSuite } from './helpers/make-suite';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { evmSnapshot, evmRevert, waitForTx } from '@aave/deploy-v3';

/**
 * End-to-end forced liquidation test suite
 *
 * This test validates the forced liquidation mechanism in Aave V3 protocol, including:
 * 1. Normal supply, borrow, repay flow
 * 2. Traditional liquidation flow (health factor < 1)
 * 3. Forced liquidation flow (health factor >= 1 but debt asset is frozen)
 *
 * The test ensures forced liquidation can only be executed under specific conditions:
 * - Debt asset is frozen
 * - Liquidator is whitelisted
 * - Forced liquidation is enabled
 */
makeSuite('Fork E2E Forced Liquidation Test', (testEnv: TestEnv) => {
  let evmSnapshotId: string;

  const { INVALID_HF } = ProtocolErrors;

  before(async () => {
    await rawBRE.deployments.fixture(['market']);
    await initializeMakeSuite();
  });

  beforeEach(async () => {
    evmSnapshotId = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(evmSnapshotId);
  });

  /**
   * Log section separator for better test output readability
   */
  const logSection = (title: string): void => {
    console.log('\n' + '='.repeat(60));
    console.log(`${title}`);
    console.log('='.repeat(60));
  };

  /**
   * Supply asset to pool helper function
   */
  const supplyAsset = async (
    pool: any,
    asset: any,
    user: any,
    amount: string,
    assetName: string
  ): Promise<BigNumber> => {
    console.log(`${user.address} supplying ${amount} ${assetName}`);

    const supplyAmount = await convertToCurrencyDecimals(asset.address, amount);

    // Mint tokens for user
    await asset.connect(user.signer)['mint(address,uint256)'](user.address, supplyAmount);

    // Approve pool contract
    await asset.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);

    // Supply to pool
    await pool.connect(user.signer).supply(asset.address, supplyAmount, user.address, '0');

    console.log(`Supply completed: ${supplyAmount.toString()} ${assetName}`);
    return supplyAmount;
  };

  /**
   * Borrow asset from pool helper function
   */
  const borrowAsset = async (
    pool: any,
    asset: any,
    user: any,
    amount: string,
    assetName: string
  ): Promise<BigNumber> => {
    console.log(`${user.address} borrowing ${amount} ${assetName}`);

    const borrowAmount = await convertToCurrencyDecimals(asset.address, amount);

    await pool
      .connect(user.signer)
      .borrow(asset.address, borrowAmount, RateMode.Variable, 0, user.address);

    console.log(`Borrow completed: ${borrowAmount.toString()} ${assetName}`);
    return borrowAmount;
  };

  /**
   * Repay borrowed asset helper function
   */
  const repayAsset = async (
    pool: any,
    asset: any,
    user: any,
    amount: string,
    assetName: string
  ): Promise<BigNumber> => {
    console.log(`${user.address} repaying ${amount} ${assetName}`);

    const repayAmount = await convertToCurrencyDecimals(asset.address, amount);

    // Mint tokens for repayment
    await asset.connect(user.signer)['mint(address,uint256)'](user.address, repayAmount);
    await asset.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(user.signer)
      .repay(asset.address, repayAmount, RateMode.Variable, user.address);

    console.log(`Repay completed: ${repayAmount.toString()} ${assetName}`);
    return repayAmount;
  };

  /**
   * Perform liquidation operation helper function
   */
  const performLiquidation = async (
    pool: any,
    collateralAsset: any,
    debtAsset: any,
    liquidator: any,
    targetUser: any,
    liquidationAmount: string,
    isForced: boolean = false
  ): Promise<{ beforeBalance: BigNumber; afterBalance: BigNumber; transaction: any }> => {
    const liquidationType = isForced ? 'forced' : 'normal';
    console.log(
      `Executing ${liquidationType} liquidation: ${liquidator.address} liquidating ${targetUser.address}`
    );

    const liquidationAmountBN = await convertToCurrencyDecimals(
      debtAsset.address,
      liquidationAmount
    );

    // Prepare liquidator's tokens
    await debtAsset
      .connect(liquidator.signer)
      ['mint(address,uint256)'](liquidator.address, liquidationAmountBN);
    await debtAsset.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    // Get balance before liquidation
    const beforeBalance = await collateralAsset.balanceOf(liquidator.address);
    const collateralSymbol = await collateralAsset.symbol();
    console.log(`${collateralSymbol} balance before: ${beforeBalance.toString()}`);

    // Execute liquidation
    const liquidationTx = await pool
      .connect(liquidator.signer)
      .liquidationCall(
        collateralAsset.address,
        debtAsset.address,
        targetUser.address,
        isForced ? MAX_UINT_AMOUNT : liquidationAmountBN,
        false
      );

    // Get balance after liquidation
    const afterBalance = await collateralAsset.balanceOf(liquidator.address);
    console.log(`${collateralSymbol} balance after: ${afterBalance.toString()}`);
    console.log(`Gained ${collateralSymbol}: ${afterBalance.sub(beforeBalance).toString()}`);

    return { beforeBalance, afterBalance, transaction: liquidationTx };
  };

  it('E2E: Complete supply, borrow, repay, liquidate, force liquidate flow', async () => {
    const {
      pool,
      users: [borrower, supplier, liquidator],
      weth,
      usdc,
      configurator,
      poolAdmin,
      oracle,
      aaveOracle,
      aWETH,
    } = testEnv;

    logSection('Phase 1: Supply Phase');

    // Borrower supplies WETH as collateral
    await supplyAsset(pool, weth, borrower, '5', 'WETH');

    // Supplier supplies USDC for liquidity
    await supplyAsset(pool, usdc, supplier, '10000', 'USDC');

    console.log('Supply operations completed');

    logSection('Phase 2: Borrow Phase');

    // Log asset prices and reserve configuration
    const wethPrice = await aaveOracle.getAssetPrice(weth.address);
    const usdcPrice = await aaveOracle.getAssetPrice(usdc.address);
    console.log(`WETH Price: ${wethPrice.toString()}`);
    console.log(`USDC Price: ${usdcPrice.toString()}`);

    // Borrower borrows USDC from pool
    // Health factor calculation: (20000 × 0.825) / 6000 = 2.75 (> 1, healthy)
    await borrowAsset(pool, usdc, borrower, '6000', 'USDC');

    // Verify health factor is greater than 1 (healthy position)
    const initialUserData = await pool.getUserAccountData(borrower.address);
    expect(initialUserData.healthFactor).to.be.gt(oneEther, INVALID_HF);

    console.log('Borrow operations completed');

    logSection('Phase 3: Repay Phase');

    // Borrower partially repays the debt
    await repayAsset(pool, usdc, borrower, '1000', 'USDC');

    // Verify health factor after repayment
    // Health factor calculation: (20000 × 0.825) / 5000 = 3.3
    const repaidUserData = await pool.getUserAccountData(borrower.address);

    // Expected health factor is 3.3, allow tolerance of 1000
    const expectedHealthFactor = oneEther.mul(33).div(10);
    expect(repaidUserData.healthFactor).to.be.closeTo(expectedHealthFactor, oneEther.div(1000));

    console.log('Repay operations completed');

    logSection('Phase 4: Setup Normal Liquidation Environment');

    // Create unhealthy position by manipulating WETH price
    console.log('Creating unhealthy WETH position');

    // Remove price source to allow manual price setting
    await waitForTx(await aaveOracle.setAssetSources([weth.address], [constants.AddressZero]));

    const wethOriginalPrice = await aaveOracle.getAssetPrice(weth.address);
    console.log(`Original price: ${wethOriginalPrice.toString()}`);

    // Drop price by 20% of original
    const newWethPrice = wethOriginalPrice.mul(20).div(100);
    await waitForTx(await oracle.setAssetPrice(weth.address, newWethPrice));

    console.log(`New price (20%): ${newWethPrice.toString()}`);
    console.log(`Unhealthy position created`);

    // Verify health factor is now below 1 (unhealthy position)
    const unhealthyUserData = await pool.getUserAccountData(borrower.address);
    expect(unhealthyUserData.healthFactor).to.be.lt(oneEther, 'Health factor should be below 1');

    console.log(unhealthyUserData.healthFactor.toString());

    console.log('Unhealthy position created');

    logSection('Phase 5: Normal Liquidation Phase');

    // Get aWETH balance before liquidation
    const borrowerWETHBefore = await aWETH.balanceOf(borrower.address);
    console.log(`Before liquidation - Borrower aWETH balance: ${borrowerWETHBefore.toString()}`);

    // Perform normal liquidation
    const normalLiquidationResult = await performLiquidation(
      pool,
      weth,
      usdc,
      liquidator,
      borrower,
      '1000',
      false
    );

    // Verify liquidation effects
    expect(normalLiquidationResult.afterBalance).to.be.gt(
      normalLiquidationResult.beforeBalance,
      'Liquidator should have received WETH'
    );

    const borrowerWETHAfter = await aWETH.balanceOf(borrower.address);
    expect(borrowerWETHAfter).to.be.lt(borrowerWETHBefore, 'Borrower should have lost aWETH');

    console.log(`After liquidation - Borrower aWETH balance: ${borrowerWETHAfter.toString()}`);

    console.log('Normal liquidation completed');

    logSection('Phase 6: Setup Forced Liquidation Environment');

    // Restore WETH price to healthy level
    await waitForTx(await oracle.setAssetPrice(weth.address, wethOriginalPrice));

    // Create new healthy borrowing position
    await borrowAsset(pool, usdc, borrower, '3000', 'USDC');

    // Verify health factor is again greater than 1
    const healthyUserData = await pool.getUserAccountData(borrower.address);
    expect(healthyUserData.healthFactor).to.be.gt(
      oneEther,
      'Health factor should be greater than 1'
    );

    // Setup forced liquidation environment
    console.log('Setting up USDC forced liquidation environment');

    // Freeze USDC asset
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setReserveFreeze(usdc.address, true)
    );
    console.log('USDC reserve frozen');

    // Enable forced liquidation for USDC
    await waitForTx(
      await configurator.connect(poolAdmin.signer).setForcedLiquidationEnabled(usdc.address, true)
    );
    console.log('USDC forced liquidation enabled');

    // Add liquidator to whitelist
    await waitForTx(
      await configurator
        .connect(poolAdmin.signer)
        .addToForcedLiquidationWhitelist(liquidator.address)
    );
    console.log(`Liquidator ${liquidator.address} added to whitelist`);

    console.log('Forced liquidation setup completed');

    logSection('Phase 7: Forced Liquidation Phase');

    // Get balances before forced liquidation
    const borrowerWETHBeforeForce = await aWETH.balanceOf(borrower.address);

    console.log(
      `Before forced liquidation - Borrower aWETH balance: ${borrowerWETHBeforeForce.toString()}`
    );

    // Perform forced liquidation (use MAX_UINT_AMOUNT to liquidate all debt)
    const forceLiquidationResult = await performLiquidation(
      pool,
      weth,
      usdc,
      liquidator,
      borrower,
      '10000',
      true
    );

    // Verify forced liquidation effects
    expect(forceLiquidationResult.afterBalance).to.be.gt(
      forceLiquidationResult.beforeBalance,
      'Liquidator should have received WETH in forced liquidation'
    );

    const borrowerWETHAfterForce = await aWETH.balanceOf(borrower.address);
    expect(borrowerWETHAfterForce).to.be.lt(
      borrowerWETHBeforeForce,
      'Borrower should have lost aWETH in forced liquidation'
    );

    console.log(
      `After forced liquidation - Borrower aWETH balance: ${borrowerWETHAfterForce.toString()}`
    );
    console.log(
      `Before forced liquidation - Borrower aWETH balance: ${borrowerWETHBeforeForce.toString()}`
    );
    console.log(`Difference: ${borrowerWETHAfterForce.sub(borrowerWETHBeforeForce).toString()}`);

    // Verify ForcedLiquidationCall event was emitted
    await expect(forceLiquidationResult.transaction).to.emit(pool, 'ForcedLiquidationCall');

    // Comprehensive debt verification test
    logSection('Phase 7.5: Comprehensive Debt Verification');

    // Get USDC reserve data to check all debt types
    const usdcReserveData = await pool.getReserveData(usdc.address);

    // Connect to variable debt token
    const variableDebtToken = VariableDebtToken__factory.connect(
      usdcReserveData.variableDebtTokenAddress,
      borrower.signer
    );

    // Connect to stable debt token
    const stableDebtToken = await rawBRE.ethers.getContractAt(
      'IStableDebtToken',
      usdcReserveData.stableDebtTokenAddress,
      borrower.signer
    );

    // Record debt status before forced liquidation verification
    console.log('Checking debt status before forced liquidation verification...');

    // Use existing helpersContract from testEnv for debt information
    console.log('Using testEnv.helpersContract for debt data...');
    const poolDataProvider = testEnv.helpersContract;

    // Check debt token balances directly
    const variableDebtBefore = await variableDebtToken.balanceOf(borrower.address);
    const stableDebtBefore = await stableDebtToken.principalBalanceOf(borrower.address);

    console.log(`Variable Debt Token balance before liquidation: ${variableDebtBefore.toString()}`);
    console.log(`Stable Debt Token balance before liquidation: ${stableDebtBefore.toString()}`);

    // Verify debt clearance status after forced liquidation
    console.log('Verifying debt clearance status after forced liquidation...');

    // Check user reserve data after liquidation
    const userReserveDataAfter = await poolDataProvider.getUserReserveData(
      usdc.address,
      borrower.address
    );

    console.log(
      `User Variable Debt after liquidation: ${userReserveDataAfter.currentVariableDebt.toString()}`
    );
    console.log(
      `User Stable Debt after liquidation: ${userReserveDataAfter.currentStableDebt.toString()}`
    );

    // Check if debt token balances are zero directly
    const variableDebtAfter = await variableDebtToken.balanceOf(borrower.address);
    const stableDebtAfter = await stableDebtToken.principalBalanceOf(borrower.address);

    console.log(`Variable Debt Token balance after liquidation: ${variableDebtAfter.toString()}`);
    console.log(`Stable Debt Token balance after liquidation: ${stableDebtAfter.toString()}`);

    // Verify all debts are cleared
    expect(
      variableDebtAfter,
      'Variable debt should be fully cleared after forced liquidation'
    ).to.be.eq(0);
    expect(
      stableDebtAfter,
      'Stable debt should be fully cleared after forced liquidation'
    ).to.be.eq(0);

    // Verify user account data debt is also zero
    expect(userReserveDataAfter.currentVariableDebt, 'User variable debt should be zero').to.be.eq(
      0
    );
    expect(userReserveDataAfter.currentStableDebt, 'User stable debt should be zero').to.be.eq(0);

    // Verify total debt is zero
    const totalDebtAfter = userReserveDataAfter.currentVariableDebt.add(
      userReserveDataAfter.currentStableDebt
    );
    expect(totalDebtAfter, 'Total debt should be zero after forced liquidation').to.be.eq(0);

    console.log(
      'All debt verification passed: All debts of borrower have been cleared after forced liquidation'
    );

    console.log('Forced liquidation completed');

    logSection('Phase 8: Final Verification');

    // Verify final health factor
    const finalUserData = await pool.getUserAccountData(borrower.address);

    // Final health factor should be greater than or equal to healthy position health factor
    expect(finalUserData.healthFactor).to.be.gte(
      healthyUserData.healthFactor,
      'Final health factor should be greater than or equal to previous healthy factor'
    );
  });
});
