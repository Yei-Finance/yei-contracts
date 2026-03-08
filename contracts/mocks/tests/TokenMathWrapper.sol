// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

import {TokenMath} from '../../protocol/libraries/helpers/TokenMath.sol';

contract TokenMathWrapper {
  function getATokenMintScaledAmount(
    uint256 amount,
    uint256 liquidityIndex
  ) public pure returns (uint256) {
    return TokenMath.getATokenMintScaledAmount(amount, liquidityIndex);
  }

  function getATokenBurnScaledAmount(
    uint256 amount,
    uint256 liquidityIndex
  ) public pure returns (uint256) {
    return TokenMath.getATokenBurnScaledAmount(amount, liquidityIndex);
  }

  function getATokenTransferScaledAmount(
    uint256 amount,
    uint256 liquidityIndex
  ) public pure returns (uint256) {
    return TokenMath.getATokenTransferScaledAmount(amount, liquidityIndex);
  }

  function getATokenBalance(
    uint256 scaledAmount,
    uint256 liquidityIndex
  ) public pure returns (uint256) {
    return TokenMath.getATokenBalance(scaledAmount, liquidityIndex);
  }

  function getVTokenMintScaledAmount(
    uint256 amount,
    uint256 variableBorrowIndex
  ) public pure returns (uint256) {
    return TokenMath.getVTokenMintScaledAmount(amount, variableBorrowIndex);
  }

  function getVTokenBurnScaledAmount(
    uint256 amount,
    uint256 variableBorrowIndex
  ) public pure returns (uint256) {
    return TokenMath.getVTokenBurnScaledAmount(amount, variableBorrowIndex);
  }

  function getVTokenBalance(
    uint256 scaledAmount,
    uint256 variableBorrowIndex
  ) public pure returns (uint256) {
    return TokenMath.getVTokenBalance(scaledAmount, variableBorrowIndex);
  }
}
