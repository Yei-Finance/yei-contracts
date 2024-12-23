import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';

// export const getPoolLibraries = async (): Promise<Libraries> => {
//     const supplyLibraryArtifact = await hre.deployments.get("SupplyLogic");
//     const borrowLibraryArtifact = await hre.deployments.get("BorrowLogic");
//     const liquidationLibraryArtifact = await hre.deployments.get(
//       "LiquidationLogic"
//     );
//     const eModeLibraryArtifact = await hre.deployments.get("EModeLogic");
//     const bridgeLibraryArtifact = await hre.deployments.get("BridgeLogic");
//     const flashLoanLogicArtifact = await hre.deployments.get("FlashLoanLogic");
//     const poolLogicArtifact = await hre.deployments.get("PoolLogic");

//     return {
//       LiquidationLogic: liquidationLibraryArtifact.address,
//       SupplyLogic: supplyLibraryArtifact.address,
//       EModeLogic: eModeLibraryArtifact.address,
//       FlashLoanLogic: flashLoanLogicArtifact.address,
//       BorrowLogic: borrowLibraryArtifact.address,
//       BridgeLogic: bridgeLibraryArtifact.address,
//       PoolLogic: poolLogicArtifact.address,
//     };
//   };

async function deployLibrary(name: string, deployFunction, deployer) {
  let library = await deployFunction(name, {
    from: deployer,
    log: true,
    contract: name,
  });
  return library.address;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { get, execute, deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  let liquidationLogic = await deployLibrary(`LiquidationLogic`, deploy, deployer);
  // await hre.run("verify:verify", {
  //   address: liquidationLogic,
  //   constructorArguments: [],
  // });
  let borrowLogic = await deployLibrary(`BorrowLogic`, deploy, deployer);
  // await hre.run("verify:verify", {
  //   address: borrowLogic,
  //   constructorArguments: [],
  // });
  let supplyLogic = await deployLibrary(`SupplyLogic`, deploy, deployer);
  // await hre.run("verify:verify", {
  //   address: supplyLogic,
  //   constructorArguments: [],
  // });
  let eModeLogic = await deployLibrary(`EModeLogic`, deploy, deployer);

  // await hre.run("verify:verify", {
  //   address: eModeLogic,
  //   constructorArguments: [],
  // });
  //   let flashLoanLogic = await deployLibrary(`FlashLoanLogic`, deploy, deployer);
  let flashLoanLogic = (
    await deploy(`FlashLoanLogic`, {
      from: deployer,
      log: true,
      libraries: {
        BorrowLogic: borrowLogic,
      },
      contract: `FlashLoanLogic`,
    })
  ).address;
  // await hre.run("verify:verify", {
  //   address: flashLoanLogic,
  //   constructorArguments: [],
  //   libraries: {
  //     BorrowLogic: borrowLogic
  //   }
  // });

  let bridgeLogic = await deployLibrary(`BridgeLogic`, deploy, deployer);
  // await hre.run("verify:verify", {
  //   address: bridgeLogic,
  //   constructorArguments: [],
  // });
  let poolLogic = await deployLibrary(`PoolLogic`, deploy, deployer);
  // await hre.run("verify:verify", {
  //   address: poolLogic,
  //   constructorArguments: [],
  // });

  let addressProvider = '0xccacdBb8E1e85e63e22fD30aD4B0521bBbB534b8';
  let pool = await deploy(`Pool`, {
    from: deployer,
    log: true,
    args: [addressProvider],
    contract: 'Pool',
    libraries: {
      LiquidationLogic: liquidationLogic,
      SupplyLogic: supplyLogic,
      EModeLogic: eModeLogic,
      FlashLoanLogic: flashLoanLogic,
      BorrowLogic: borrowLogic,
      BridgeLogic: bridgeLogic,
      PoolLogic: poolLogic,
    },
  });
  await hre.run('verify:verify', {
    address: pool.address,
    constructorArguments: [addressProvider],
    libraries: {
      BridgeLogic: bridgeLogic,
      EModeLogic: eModeLogic,
      FlashLoanLogic: flashLoanLogic,
      LiquidationLogic: liquidationLogic,
      PoolLogic: poolLogic,
      SupplyLogic: supplyLogic,
    },
  });
};
export default func;
func.tags = ['deploy'];
