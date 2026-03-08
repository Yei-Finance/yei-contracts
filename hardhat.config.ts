import { defineConfig } from 'hardhat/config';
import hardhatToolboxViem from '@nomicfoundation/hardhat-toolbox-viem';

export default defineConfig({
  plugins: [hardhatToolboxViem],

  solidity: {
    version: '0.8.10',
    settings: {
      optimizer: {
        enabled: true,
        runs: 100000,
      },
      evmVersion: 'london',
    },
  },

  networks: {
    // In Hardhat 3 the default in-process network is named "default"
    default: {
      type: 'edr-simulated',
      hardfork: 'london',
      blockGasLimit: 30_000_000,
      allowUnlimitedContractSize: true,
    },
  },

  paths: {
    tests: {
      nodejs: './test',
    },
  },
});
