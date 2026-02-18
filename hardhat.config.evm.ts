import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "./plugins/voting-escrow-testnet";         // testnet constants patching
import { getNetworkName, getDeployerPrivateKey } from "./deploy/config-env";

// EVM networks only - fallback to hardhat if zkSync network is configured
const evmNetworks = ['bscTestnet', 'bscMainnet', 'hyperliquidTestnet', 'hardhat'];
const networkName = getNetworkName();
const defaultNetwork = evmNetworks.includes(networkName) ? networkName : 'hardhat';

const config: HardhatUserConfig = {
    defaultNetwork,

    networks: {
        hardhat: {},
        bscTestnet: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            chainId: 97,
            accounts: [getDeployerPrivateKey()],
        },
        bscMainnet: {
            url: "https://bsc-dataseed.binance.org",
            chainId: 56,
            accounts: [getDeployerPrivateKey()],
        },
        hyperliquidTestnet: {
            url: "https://rpcs.chain.link/hyperevm/testnet",
            chainId: 998,
            accounts: [getDeployerPrivateKey()],
        },
    },

    // Etherscan V2 API config
    etherscan: {
        apiKey: process.env.ABS_ETHERSCAN_API_KEY || "",
        customChains: [
            {
                network: "bscTestnet",
                chainId: 97,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=97",
                    browserURL: "https://testnet.bscscan.com/",
                },
            },
            {
                network: "bscMainnet",
                chainId: 56,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=56",
                    browserURL: "https://bscscan.com/",
                },
            },
        ],
    },

    solidity: {
        compilers: [
            {
                version: "0.8.24",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    evmVersion: "paris",
                },
            },
            {
                version: "0.8.13",  // for Velodrome contracts
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    evmVersion: "london",
                },
            },
        ],
    },

    sourcify: {
        enabled: true,
    },
};

export default config;