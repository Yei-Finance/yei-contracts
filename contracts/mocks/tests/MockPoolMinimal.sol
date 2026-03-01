// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IPoolAddressesProvider} from '../../interfaces/IPoolAddressesProvider.sol';
import {IAToken} from '../../interfaces/IAToken.sol';
import {IVariableDebtToken} from '../../interfaces/IVariableDebtToken.sol';

/**
 * @title MockAddressesProviderMin
 * @notice Minimal addresses provider stub used only during token construction.
 *         None of the pool-admin-guarded functions are exercised in rounding tests,
 *         so returning address(0) for getACLManager() is safe.
 */
contract MockAddressesProviderMin {
  function getACLManager() external pure returns (address) {
    return address(0);
  }

  function getPool() external view returns (address) {
    return address(this);
  }
}

/**
 * @title MockPoolMinimal
 * @notice Minimal mock of IPool that is sufficient for deploying and exercising
 *         AToken and VariableDebtToken in unit tests focused on rounding math.
 *
 *         It acts as the pool itself so that `onlyPool`-gated calls succeed when
 *         invoked through the proxy helpers below.
 */
contract MockPoolMinimal {
  IPoolAddressesProvider public immutable addressesProvider;

  uint256 public liquidityIndex;
  uint256 public variableBorrowIndex;

  constructor() {
    addressesProvider = IPoolAddressesProvider(address(new MockAddressesProviderMin()));
    liquidityIndex = 1e27; // RAY — index of 1
    variableBorrowIndex = 1e27;
  }

  // ─── IPool surface used by AToken / VariableDebtToken ───────────────────

  function ADDRESSES_PROVIDER() external view returns (IPoolAddressesProvider) {
    return addressesProvider;
  }

  function getReserveNormalizedIncome(address) external view returns (uint256) {
    return liquidityIndex;
  }

  function getReserveNormalizedVariableDebt(address) external view returns (uint256) {
    return variableBorrowIndex;
  }

  /// @notice No-op — called by AToken._transfer when validate=true
  function finalizeTransfer(address, address, address, uint256, uint256, uint256) external {}

  // ─── Index setters ───────────────────────────────────────────────────────

  function setLiquidityIndex(uint256 idx) external {
    liquidityIndex = idx;
  }

  function setVariableBorrowIndex(uint256 idx) external {
    variableBorrowIndex = idx;
  }

  // ─── AToken proxy helpers (msg.sender == pool == this) ──────────────────

  function mintAToken(
    IAToken token,
    address caller,
    address onBehalfOf,
    uint256 amount,
    uint256 index
  ) external returns (bool) {
    return token.mint(caller, onBehalfOf, amount, index);
  }

  function burnAToken(
    IAToken token,
    address from,
    address receiverOfUnderlying,
    uint256 amount,
    uint256 index
  ) external {
    token.burn(from, receiverOfUnderlying, amount, index);
  }

  function mintToTreasury(IAToken token, uint256 amount, uint256 index) external {
    token.mintToTreasury(amount, index);
  }

  // ─── VariableDebtToken proxy helpers ────────────────────────────────────

  function mintVToken(
    IVariableDebtToken token,
    address user,
    address onBehalfOf,
    uint256 amount,
    uint256 index
  ) external returns (bool, uint256) {
    return token.mint(user, onBehalfOf, amount, index);
  }

  function burnVToken(
    IVariableDebtToken token,
    address from,
    uint256 amount,
    uint256 index
  ) external returns (bool, uint256) {
    return token.burn(from, amount, index);
  }
}
