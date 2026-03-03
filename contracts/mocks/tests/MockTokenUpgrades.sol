// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.10;

import {AToken} from '../../protocol/tokenization/AToken.sol';
import {VariableDebtToken} from '../../protocol/tokenization/VariableDebtToken.sol';
import {StableDebtToken} from '../../protocol/tokenization/StableDebtToken.sol';
import {IPool} from '../../interfaces/IPool.sol';

/// @dev AToken v3 — higher revision so upgradeToAndCall can re-initialize the proxy
contract MockATokenV3 is AToken {
  constructor(IPool pool) AToken(pool) {}

  function getRevision() internal pure override returns (uint256) {
    return 3;
  }
}

/// @dev VariableDebtToken v2 — higher revision so upgradeToAndCall can re-initialize the proxy
contract MockVariableDebtTokenV2 is VariableDebtToken {
  constructor(IPool pool) VariableDebtToken(pool) {}

  function getRevision() internal pure override returns (uint256) {
    return 2;
  }
}

/// @dev StableDebtToken v2 — higher revision so upgradeToAndCall can re-initialize the proxy
contract MockStableDebtTokenV2 is StableDebtToken {
  constructor(IPool pool) StableDebtToken(pool) {}

  function getRevision() internal pure override returns (uint256) {
    return 2;
  }
}
