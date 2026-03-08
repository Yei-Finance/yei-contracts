// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {WadRayMath} from '../math/WadRayMath.sol';

/**
 * @title TokenMath
 * @notice Utility functions for computing scaled amounts and unscaled balances for aTokens and
 * vTokens, applying directional rounding that always favors the protocol over the user
 * (ERC-4626 style). All rounding decisions are centralized here so that a single change
 * in this file updates every callsite.
 */
library TokenMath {
  using WadRayMath for uint256;

  // ─── AToken (supply-side) ────────────────────────────────────────────────

  /**
   * @notice Scaled amount of aTokens to mint when supplying underlying assets.
   * Rounded down so the user receives fewer scaled tokens — protocol-favored.
   * @param amount The amount of underlying asset supplied.
   * @param liquidityIndex The current aToken liquidity index.
   * @return The scaled amount of aTokens to mint.
   */
  function getATokenMintScaledAmount(
    uint256 amount,
    uint256 liquidityIndex
  ) internal pure returns (uint256) {
    return amount.rayDivFloor(liquidityIndex);
  }

  /**
   * @notice Scaled amount of aTokens to burn when withdrawing underlying assets.
   * Rounded up so the user burns more scaled tokens — protocol-favored.
   * @param amount The amount of underlying asset to withdraw.
   * @param liquidityIndex The current aToken liquidity index.
   * @return The scaled amount of aTokens to burn.
   */
  function getATokenBurnScaledAmount(
    uint256 amount,
    uint256 liquidityIndex
  ) internal pure returns (uint256) {
    return amount.rayDivCeil(liquidityIndex);
  }

  /**
   * @notice Scaled amount of aTokens to move in a transfer.
   * Rounded up so the sender's balance is sufficiently reduced — protocol-favored.
   * @param amount The underlying-equivalent amount being transferred.
   * @param liquidityIndex The current aToken liquidity index.
   * @return The scaled amount of aTokens to transfer.
   */
  function getATokenTransferScaledAmount(
    uint256 amount,
    uint256 liquidityIndex
  ) internal pure returns (uint256) {
    return amount.rayDivCeil(liquidityIndex);
  }

  /**
   * @notice Unscaled aToken balance from a scaled balance and the current liquidity index.
   * Rounded down — user sees slightly less, protocol-favored.
   * @param scaledAmount The scaled aToken balance.
   * @param liquidityIndex The current aToken liquidity index.
   * @return The actual aToken balance.
   */
  function getATokenBalance(
    uint256 scaledAmount,
    uint256 liquidityIndex
  ) internal pure returns (uint256) {
    return scaledAmount.rayMulFloor(liquidityIndex);
  }

  // ─── VariableDebtToken (borrow-side) ─────────────────────────────────────

  /**
   * @notice Scaled amount of vTokens to mint when borrowing.
   * Rounded up so the protocol never underaccounts the user's debt — protocol-favored.
   * @param amount The amount of underlying asset borrowed.
   * @param variableBorrowIndex The current vToken variable borrow index.
   * @return The scaled amount of vTokens to mint.
   */
  function getVTokenMintScaledAmount(
    uint256 amount,
    uint256 variableBorrowIndex
  ) internal pure returns (uint256) {
    return amount.rayDivCeil(variableBorrowIndex);
  }

  /**
   * @notice Scaled amount of vTokens to burn when repaying.
   * Rounded down to prevent over-burning of vTokens — protocol-favored.
   * @param amount The amount of underlying asset being repaid.
   * @param variableBorrowIndex The current vToken variable borrow index.
   * @return The scaled amount of vTokens to burn.
   */
  function getVTokenBurnScaledAmount(
    uint256 amount,
    uint256 variableBorrowIndex
  ) internal pure returns (uint256) {
    return amount.rayDivFloor(variableBorrowIndex);
  }

  /**
   * @notice Unscaled vToken balance (debt) from a scaled balance and the current borrow index.
   * Rounded up — user sees slightly more debt, protocol-favored.
   * @param scaledAmount The scaled vToken balance.
   * @param variableBorrowIndex The current vToken variable borrow index.
   * @return The actual vToken balance (debt).
   */
  function getVTokenBalance(
    uint256 scaledAmount,
    uint256 variableBorrowIndex
  ) internal pure returns (uint256) {
    return scaledAmount.rayMulCeil(variableBorrowIndex);
  }
}
