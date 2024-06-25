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

# Dev Doc

[Link](https://yei-finance.notion.site/Prepare-Dev-Doc-for-partners-f4da6221ec164e23b52eaa5875026f7d)
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
| ACLManager  | 0x241995B768C1ae629EB5A6F3749C6E7b8C4d47F2    |
| Oracle | 0xA1ce28cEbaB91d8dF346D19970E4Ee69A6989734     |
| PoolAddressesProvider    | 0x5C57266688A4aD1d3aB61209ebcb967B84227642    |
| PoolAddressesProviderRegistry  | 0x8138Da4417340594AeEa4BE8FBC7693d9875B6CB    |
| Pool-Proxy | 0x4a4d9abD36F923cBA0Af62A39C01dEC2944fb638     |
| PoolConfigurator-Proxy    | 0xf8157786e3401A7377BECb7Af288b84c8eE614E1    |
| PoolDataProvider | 0x60c82A40C57736a9c692C42e87A8849Fb407F0d6     |
| IncentivesProxy    | 0x60485C5E5E3D535B16CC1bd2C9243C7877374259    |
| EmissionManager | 0x69ea2c310a950E58984f4bEc4acCf2ECe391dafD     |
| TreasuryController    | 0x4eC5e3f9A32aaBD6AF62B9A22188F429d65F39c7    |
| Treasury | 0xbf63C919A8C15f4741E75c232c7Be0d0af4d1D05     |
| PullTransferStrategy    | 0x67b440B71Fa2CB8e9a91A4FfB3E89A6976FcC608    |
| Incentive-Implementation | 0x800F3E929686eC90EeAAbB8b98ED1eFF126d532c     |
| Pool-Implementation | 0xd078C43f88Fbed47b3Ce16Dc361606B594c8F305     |
| PoolConfiguration-Implementation    | 0x80C4cdee95E52a8ad2C57eC3265Bea3A9c91669D    |
| Treasury-Implementation | 0x374865D6Aa24A7523a6176cE25e05cF6dc826304     |
| WalletBalanceProvider    |  0x81fCEe5b9536DC0C626ddAe6c84B9802842a57AE  |
| WrappedTokenGatewayV3 |   0x10E4970D5C22aDf49a3CeEd9c01d66775C065f8E   |
| UiIncentiveDataProviderV3    | 0xD25Ce1D2F20868C610726a9d7c675EA9A8359c55    |
| UiPoolDataProviderV3    | 0xeB0CC27b656775bF27Dc7A3c1cf570e002f727Da    |

### Oracle
| Asset    | Address |
| -------- | ------- |
| SEI  | 0xa2aCDc40e5ebCE7f8554E66eCe6734937A48B3f3    |
| USDC | 0xEAb459AD7611D5223A408A2e73b69173F61bb808     |
| USDT    | 0x284db472a483e115e3422dd30288b24182E36DdB    |
| ETH  | 0x3E45Fb956D2Ba2CB5Fa561c40E5912225E64F7B2    |

### Logic
| Contract Name    | Address |
| -------- | ------- |
| BorrowLogic  | 0xF7dD04ecbB8De9569A9Dd2D2Cc546fa8e579B54E    |
| BridgeLogic | 0x3b28C1c795F1382a083D822dc2997eeF49505643     |
| ConfiguratorLogic    | 0xBed70224331e0A01C0b194163f8242Ad7AF3cAbF    |
| EModeLogic  | 0x81dEEcD10A76C1da037079EeB09D0b84e746C038    |
| FlashLoanLogic | 0xA4bFc89476eA68A0a649612BB259aac8E2f2Bb19     |
| LiquidationLogic    | 0x5d1c6e0D69e962851b315BC9eff92D5189189c6b    |
| PoolLogic  | 0x8301B04D9641aD2C52Be2108B0b41d0F9164254D    |
| SupplyLogic | 0x0F8286f6aa0ecF83C9C1d87DAc974871D0573421     |
| ReservesSetupHelper    | 0x3132Fe205aCcd04295789FF1FB3abcc10aC3d5c6    |

### Token
#### Implementation
| Name    | Address |
| -------- | ------- |
| AToken  | 0x51c5FD7783358aFe244EBB74aa8963e152FAd73b    |
| DelegationAwareAToken | 0xc6388fDC02066849643059F0265202109f83b74A     |
| StableDebtToken    | 0xEE2aAa4329AD3aaDDD1Ac8e986e174760ba0a4F3    |
| VariableDevtToken  | 0xC7aea6F527fd67E190165000118330Bc5eac26F9    |

#### USDC
| Name    | Address |
| -------- | ------- |
| USDC  | 0x3894085Ef7Ff0f0aeDf52E2A2704928d1Ec074F1    |
| USDC-AToken | 0xc1a6F27a4CcbABB1C2b1F8E98478e52d3D3cB935     |
| USDC-VariableDebtToken    | 0x5Bfc2d187e8c7F51BE6d547B43A1b3160D72a142    |
| USDC-StableDebtToken  | 0xe8348837A3be3212E50F030DFf935Ae0A0eA4B54    |
| USDC-RateStrategy  | 0xa753CB2ED8dA813aA1FD4C64C7BB0FE034D8cfbb    |

#### USDT
| Name    | Address |
| -------- | ------- |
| USDT  | 0xB75D0B03c06A926e488e2659DF1A861F860bD3d1    |
| USDT-AToken | 0x945C042a18A90Dd7adb88922387D12EfE32F4171     |
| USDT-VariableDebtToken    | 0x25eA70DC3332b9960E1284D57ED2f6A90d4a8373    |
| USDT-StableDebtToken  | 0x04Ba7e1387dcBE7e1fC43Dc8dE5dE8A73a77b1ee    |
| USDT-RateStrategy  | 0x80C1AFE0770287A9Ec9B6cC1ca2aAE354Ec8Af2a    |

#### WSEI
| Name    | Address |
| -------- | ------- |
| WSEI  | 0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7    |
| WSEI-AToken | 0x809FF4801aA5bDb33045d1fEC810D082490D63a4     |
| WSEI-VariableDebtToken    | 0x648e683aaE7C18132564F8B48C625aE5038A9607    |
| WSEI-StableDebtToken  | 0x4dE99D1f91A1d731966fa250b432fF17C9C234d9    |
| WSEI-RateStrategy  | 0x33AFe4892aB282544C8700a61984886D44E96EaC    |
