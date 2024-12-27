// use hardhat run to call poolconfigurator.updateAToken
// use hardhat run to call poolconfigurator.updateStableDebtToken
// use hardhat run to call poolconfigurator.updateVariableDebtToken

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { get, execute, deploy } = deployments;

  const PRIVATE_KEY = process.env.PRIVATE_KEY || hre.network.config.accounts[0];

  // Create wallet from private key
  const deployer = new ethers.Wallet(PRIVATE_KEY, ethers.provider);
  console.log('deployer', deployer.address);
  let configuratorAddress = '0x0733D63e871D426430F9799997D57613705752cf';
  let configuratorContract = await ethers.getContractAt(
    [
      'function updateAToken(tuple(address asset, address treasury, address incentivesController, string name, string symbol, address implementation, bytes params) input)',
      'function updateVariableDebtToken(tuple(address asset, address incentivesController, string name, string symbol, address implementation, bytes params) input)',
      'function dropReserve(address asset)',
    ],
    configuratorAddress
  );
  let aTokenImplAddress = '0x1FfD8Fed4d26B3966Fe821A50c7d51aA693eD93a';
  let variableDebtTokenImplAddress = '0x05C91590D3e7e487415A138a80dBf7DAEc706111';
  // call updateAToken

  let treasury = '0xd179a5b823a626884640bF36Cd33c870AeFFDBBb';
  let incentivesController = '0x3E231aD760bd8ccc8AAe3BdD9613C4F8AEB048eF';
  let name = 'Yei WBTC V2';
  let symbol = 'yWBTCV2';
  let params = '0x10';
  let wbtc = '0x91f077956442b544b81c7cd24232d4f616a6fb6d';
  const aTokenTx = await deployer.sendTransaction({
    to: configuratorAddress,
    data: configuratorContract.interface.encodeFunctionData('updateAToken', [
      {
        asset: wbtc,
        treasury: treasury,
        incentivesController: incentivesController,
        name: name,
        symbol: symbol,
        implementation: aTokenImplAddress,
        params: params,
      },
    ]),
    gasLimit: 10000000,
  });

  console.log('updateAToken transaction sent:', aTokenTx.hash);

  const variableDebtTokenTx = await deployer.sendTransaction({
    to: configuratorAddress,
    data: configuratorContract.interface.encodeFunctionData('updateVariableDebtToken', [
      {
        asset: wbtc,
        incentivesController: incentivesController,
        name: name,
        symbol: symbol,
        implementation: variableDebtTokenImplAddress,
        params: params,
      },
    ]),
    gasLimit: 10000000,
  });
  console.log('variableDebtTokenTx', variableDebtTokenTx.hash);

  const dropReserveTx = await deployer.sendTransaction({
    to: configuratorAddress,
    data: configuratorContract.interface.encodeFunctionData('dropReserve', [wbtc]),
    gasLimit: 10000000,
  });
  console.log('dropReserveTx', dropReserveTx.hash);
};
export default func;
func.tags = ['configure'];
