[![Build pass](https://github.com/aave/aave-v3-core/actions/workflows/node.js.yml/badge.svg)](https://github.com/aave/aave-v3-core/actions/workflows/node.js.yml)
[![codecov](https://codecov.io/gh/aave/aave-v3-core/branch/master/graph/badge.svg?token=U50KN38G67)](https://codecov.io/gh/aave/aave-v3-core)

```
        .///.                .///.     //.            .//  `/////////////-
       `++:++`              .++:++`    :++`          `++:  `++:......---.`
      `/+: -+/`            `++- :+/`    /+/         `/+/   `++.
      /+/   :+/            /+:   /+/    `/+/        /+/`   `++.
  -::/++::`  /+:       -::/++::` `/+:    `++:      :++`    `++/:::::::::.
  -:+++::-`  `/+:      --++/---`  `++-    .++-    -++.     `++/:::::::::.
   -++.       .++-      -++`       .++.    .++.  .++-      `++.
  .++-         -++.    .++.         -++.    -++``++-       `++.
 `++:           :++`  .++-           :++`    :+//+:        `++:----------`
 -/:             :/-  -/:             :/.     ://:         `/////////////-
```

# Aave Protocol v3

This repository contains the smart contracts source code and markets configuration for Aave Protocol V3. The repository uses Docker Compose and Hardhat as development environment for compilation, testing and deployment tasks.

## What is Aave?

Aave is a decentralized non-custodial liquidity markets protocol where users can participate as suppliers or borrowers. Suppliers provide liquidity to the market to earn a passive income, while borrowers are able to borrow in an overcollateralized (perpetually) or undercollateralized (one-block liquidity) fashion.

## Documentation

See the link to the technical paper or visit the Aave Developer docs

- [Technical Paper](./techpaper/Aave_V3_Technical_Paper.pdf)

- [Developer Documentation](https://docs.aave.com/developers/)

## Audits and Formal Verification

You can find all audit reports under the audits folder

V3.0.1 - December 2022

- [PeckShield](./audits/09-12-2022_PeckShield_AaveV3-0-1.pdf)
- [SigmaPrime](./audits/23-12-2022_SigmaPrime_AaveV3-0-1.pdf)

V3 Round 1 - October 2021

- [ABDK](./audits/27-01-2022_ABDK_AaveV3.pdf)
- [OpenZeppelin](./audits/01-11-2021_OpenZeppelin_AaveV3.pdf)
- [Trail of Bits](./audits/07-01-2022_TrailOfBits_AaveV3.pdf)
- [Peckshield](./audits/14-01-2022_PeckShield_AaveV3.pdf)

V3 Round 2 - December 2021

- [SigmaPrime](./audits/27-01-2022_SigmaPrime_AaveV3.pdf)

Formal Verification - November 2021-January 2022

- [Certora](./certora/Aave_V3_Formal_Verification_Report_Jan2022.pdf)

## Connect with the community

You can join the [Discord](http://aave.com/discord) channel or the [Governance Forum](https://governance.aave.com/) to ask questions about the protocol or talk about Aave with other peers.

## Getting Started

You can install `@aave/core-v3` as an NPM package in your Hardhat or Truffle project to import the contracts and interfaces:

`npm install @aave/core-v3`

Import at Solidity files:

```
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";

contract Misc {

  function supply(address pool, address token, address user, uint256 amount) public {
    IPool(pool).supply(token, amount, user, 0);
    {...}
  }
}
```

The JSON artifacts with the ABI and Bytecode are also included in the bundled NPM package at `artifacts/` directory.

Import JSON file via Node JS `require`:

```
const PoolV3Artifact = require('@aave/core-v3/artifacts/contracts/protocol/pool/Pool.sol/Pool.json');

// Log the ABI into console
console.log(PoolV3Artifact.abi)
```

## Setup

The repository uses Docker Compose to manage sensitive keys and load the configuration. Prior to any action like test or deploy, you must run `docker-compose up` to start the `contracts-env` container, and then connect to the container console via `docker-compose exec contracts-env bash`.

Follow the next steps to setup the repository:

- Install `docker` and `docker-compose`
- Create an environment file named `.env` and fill the next environment variables

```
# Add Alchemy or Infura provider keys, alchemy takes preference at the config level
ALCHEMY_KEY=""
INFURA_KEY=""


# Optional, if you plan to use Tenderly scripts
TENDERLY_PROJECT=""
TENDERLY_USERNAME=""

```

## Test

You can run the full test suite with the following commands:

```
# In one terminal
docker-compose up

# Open another tab or terminal
docker-compose exec contracts-env bash

# A new Bash terminal is prompted, connected to the container
npm run test
```

## Depoloyed Contracts

### Protocol
| Contract Name    | Address |
| -------- | ------- |
| ACLManager  | 0x9F43863188A571885BDC2624CDbB0f69e92F7c9B    |
| Oracle | 0xC2C564f2BeDa896635fd00E767fc9D5A114114Ef     |
| PoolAddressesProvider    | 0xF87151Ee99C53Bedf04d11F3e2eAF7e0b7199453    |
| PoolAddressesProviderRegistry  | 0x2c66c91d0B502e39CaA1193bf87A123109bdd801    |
| Pool-Proxy | 0x297Ac5f3AdCBF537b8d676c2Cf7C0ADFae27e974     |
| PoolConfigurator-Proxy    | 0xE1C71CFC94cb1ef15BBcc5937D174912a48D0f52    |
| PoolDataProvider | 0xda57E7dD329b7B83671538a22Ae66a4fFFf97443     |
| IncentivesProxy    | 0xC518cE1404017208aF582F2a5F4c55b632F8d56C    |
| EmissionManager | 0x69599C4d548d02c3310a194Da92CD6076aFb907E     |
| TreasuryController    | 0xD32e65b90f147Ea9D449BDBA6597a9ad54A2c2c0    |
| Treasury | 0x5461fEc48EC5048200Bc47f37028D075eCdA6e58     |
| PullTransferStrategy    | 0xf06b0F059472198eb2f586ad135E6e37949bF6FA    |
| Incentive-Implementation | 0x26D921664B704E9034C72bDdfF8073611f399c65     |
| PoolConfigurator-Proxy    | 0xE1C71CFC94cb1ef15BBcc5937D174912a48D0f52    |
| Pool-Implementation | 0x1121dF06067156cccAaff0Fa7153CDF5Edd3ab3c     |
| PoolConfiguration-Implementation    | 0x6996682D24604B16b293A85Af697a2fAa9d46F6F    |
| Treasury-Implementation | 0x13DBdb345895DbAA9A4E43eb87Fa1D582A4797a1     |
| WalletBalanceProvider    |  0x445D9B2a9338A9651C818Ec38F6f505882303983  |
| WrappedTokenGatewayV3 |   0x5eD4B77D16279Eb13E892228b520615E6bC4b296   |
| UiIncentiveDataProviderV3    | 0x843a26fB1e2fcE303620E9035B73340338506a32    |
| UiPoolDataProviderV3    | 0xFC0D48A7442a6daD7E8f20f25AF87b0c7Ba9986F    |

### Oracle
| Asset    | Address |
| -------- | ------- |
| SEI  | 0xDCC0CfA48eCaD4ce2fB35d259964eEBF7D38FFA7    |
| USDC | 0x1995C946cB7c74c3EbDA3BE5EEcBD6559CfFdce4     |
| USDT    | 0xe78625491B358873516CeEd3450ba547585193bF    |
| ETH  | 0x3bE7a85cc186a8659097b584C677462577a1095C    |

### Logic
| Contract Name    | Address |
| -------- | ------- |
| BorrowLogic  | 0x1959BfD20e4738fcA2c22B15E8c4B4eeB37dc4D5    |
| BridgeLogic | 0x832f5975993953BDe07Ab5975F44B24125F6070f     |
| ConfiguratorLogic    | 0xA7cdE1312dC648C8a4820737bE2d158A12c004c3    |
| EModeLogic  | 0xedAc7B9ae8A4b5e23cAC5DF88e9F4F8E7A454AF5    |
| FlashLoanLogic | 0xffFF245dD7be925CbA08BF0c9BF234e6F8afeF4D     |
| LiquidationLogic    | 0x1008709e82868500D67A7dEDadf0b6275B1b6F2c    |
| PoolLogic  | 0x5C70eE2211d70feb76e848690a34aC5FA91bA17C    |
| SupplyLogic | 0xc5eB743DA748c8DCDc8485F4D99d8cF002D50403     |
| ReservesSetupHelper    | 0x893a057E0F21e74579703152aC0FaB032964A96e    |

### Token
#### Implementation
| Name    | Address |
| -------- | ------- |
| AToken  | 0x2eA8987cC74058E9B31ff4e9B47E00Ecaea3da21    |
| DelegationAwareAToken | 0x9F20478b19c0cf07175B26b71F369165a1aE7De3     |
| StableDebtToken    | 0x6E6b91b1D0eeDc84342179fD43ABD45a1769760a    |
| VariableDevtToken  | 0x14af6D103e9270A60c2FA0C412898CEd92714E35    |

#### USDC
| Name    | Address |
| -------- | ------- |
| USDC  | 0x3894085Ef7Ff0f0aeDf52E2A2704928d1Ec074F1    |
| USDC-AToken | 0xF37d13B0008b177fF47296Fc0A15c9935086821d     |
| USDC-VariableDebtToken    | 0xBd046d6134529dfcBAD43Bb5860dB810Ef907A71    |
| USDC-StableDebtToken  | 0xfA17185Ac2f375072301147597c760Aa2b858d35    |
| USDC-RateStrategy  | 0xB1b1Ede4d925530ae4c3047c0C31F7B12E9Cd81a    |

#### USDT
| Name    | Address |
| -------- | ------- |
| USDT  | 0xB75D0B03c06A926e488e2659DF1A861F860bD3d1    |
| USDT-AToken | 0x16466Ec0CE0c300D5f66Db4992b610519c8e8Fce     |
| USDT-VariableDebtToken    | 0x37B72b33edbEa00A359124D7DEDDC08E23Dc297c    |
| USDT-StableDebtToken  | 0x069f8b5CD7C95EF8E6F95b2e662eBc775aE19319    |
| USDT-RateStrategy  | 0x2c466033a4C776A292f764B42D1FC233dA001794    |

#### WSEI
| Name    | Address |
| -------- | ------- |
| WSEI  | 0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7    |
| WSEI-AToken | 0xd3C367195f96A9387564287a28D935adb44D4531     |
| WSEI-VariableDebtToken    | 0xDA3e27305A7A29eC9f40b1380E24aE5Af803F57D    |
| WSEI-StableDebtToken  | 0xE950be59473fe39584FD7261F9C0ADeBD19331e0    |
| WSEI-RateStrategy  | 0xAc19b49532905Ab8B4D7637aA594f04Fb7E9122d    |