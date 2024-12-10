import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { get, execute, deploy } = deployments;

  const { deployer, pool } = await getNamedAccounts();
  let WadRayMath = await deploy(`WadRayMath`, {
    from: deployer,
    log: true,
    contract: 'WadRayMath',
  });
  let SafeCast = await deploy(`SafeCast`, {
    from: deployer,
    log: true,
    contract: 'SafeCast',
  });
  let GPv2SafeERC20 = await deploy(`GPv2SafeERC20`, {
    from: deployer,
    log: true,
    contract: 'GPv2SafeERC20',
  });
  let newAToken = await deploy(`AToken`, {
    from: deployer,
    log: true,
    args: [pool],
    contract: 'AToken',
    libraries: {
      WadRayMath: (await get('WadRayMath')).address,
      SafeCast: (await get('SafeCast')).address,
      GPv2SafeERC20: (await get('GPv2SafeERC20')).address,
    },
  });
  let newVariableDebtToken = await deploy(`VariableDebtToken`, {
    from: deployer,
    log: true,
    args: [pool],
    contract: 'VariableDebtToken',
    libraries: {
      WadRayMath: (await get('WadRayMath')).address,
      SafeCast: (await get('SafeCast')).address,
      GPv2SafeERC20: (await get('GPv2SafeERC20')).address,
    },
  });
};
export default func;
func.tags = ['deploy'];
