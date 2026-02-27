// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {WadRayMath} from '../math/WadRayMath.sol';

library TokenMath {
  using WadRayMath for uint256;

  /// @dev AToken balance: scaledAmount * index, floor — user sees slightly less (protocol-favored)
  function getATokenBalance(uint256 scaledAmount, uint256 index) internal pure returns (uint256) {
    return scaledAmount.rayMulFloor(index);
  }

  /// @dev VToken balance: scaledAmount * index, ceil — user sees slightly more debt (protocol-favored)
  function getVTokenBalance(uint256 scaledAmount, uint256 index) internal pure returns (uint256) {
    return scaledAmount.rayMulCeil(index);
  }
}
