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
  let configuratorAddress = '0x50515f54b268Ddc6719c1Db3C1fC6Fd75E6700f3';
  let hubController = '0x767B24cc51400173C93bc6edca7AE1eb61f7f210';
  let aclManager = '0x23300feB27d851de31233f8cAdF58423c8DEF615';
  let poolAddressProviderAddress = '0xccacdBb8E1e85e63e22fD30aD4B0521bBbB534b8';
  let aclManagerContract = await ethers.getContractAt(
    ['function addBridge(address bridge)'],
    aclManager
  );
  let addressProviderContract = await ethers.getContractAt(
    ['function setPoolImpl(address poolImpl)'],
    poolAddressProviderAddress
  );
  let poolImpl = '0xF2786A563240bF7006731023D95a4873Fcd2f00f';
  // const poolTxn = await deployer.sendTransaction({
  //   to: poolAddressProviderAddress,
  //   data: addressProviderContract.interface.encodeFunctionData('setPoolImpl', [poolImpl]),
  //   gasLimit: 10000000,
  // });
  // console.log('poolTxn', poolTxn.hash);
  const intentTxn = await deployer.sendTransaction({
    to: '0x767B24cc51400173C93bc6edca7AE1eb61f7f210',
    data: '0xc751c127000000000000000000000000000000000000000000000000000000000000a4b10000000000000000000000000000000000000000000000000000000000000005',
    gasLimit: 10000000,
  });
  console.log('intentTxn', intentTxn.hash);
  // const addBridgeTxn = await deployer.sendTransaction({
  //   to: aclManager,
  //   data: aclManagerContract.interface.encodeFunctionData('addBridge', [hubController]),
  //   gasLimit: 10000000,
  // });

  // console.log('addBridge transaction sent:', addBridgeTxn.hash);
};
export default func;
func.tags = ['configure'];
