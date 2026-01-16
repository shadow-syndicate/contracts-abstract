import { HardhatUserConfig } from "hardhat/config";
import "@matterlabs/hardhat-zksync";              // keep this
import "@nomicfoundation/hardhat-verify";         // use this for Etherscan V2
import { getNetworkName, getDeployerPrivateKey } from "./deploy/config-env";

const config: HardhatUserConfig = {
    zksolc: {
        version: "1.5.15",
        settings: { enableEraVMExtensions: false },
    },

    defaultNetwork: getNetworkName(),

    networks: {
        hardhat: {
            zksync: true,
        },
        inMemoryNode: {
            url: "http://127.0.0.1:8011",
            ethNetwork: "localhost",
            zksync: true,
        },
        abstractTestnet: {
            url: "https://api.testnet.abs.xyz",
            ethNetwork: "sepolia",
            zksync: true,
            chainId: 11124,
        },
        abstractMainnet: {
            url: "https://api.mainnet.abs.xyz",
            ethNetwork: "mainnet",
            zksync: true,
            chainId: 2741,
        },
        bscTestnet: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            chainId: 97,
            zksync: false,
            accounts: [getDeployerPrivateKey()],
        },
        bscMainnet: {
            url: "https://bsc-dataseed.binance.org",
            chainId: 56,
            zksync: false,
            accounts: [getDeployerPrivateKey()],
        },
    },

    // Etherscan V2 config - single API key for all chains
    etherscan: {
        apiKey: process.env.ABS_ETHERSCAN_API_KEY || "",
        customChains: [
            {
                network: "abstractTestnet",
                chainId: 11124,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=11124",
                    browserURL: "https://sepolia.abscan.org/",
                },
            },
            {
                network: "abstractMainnet",
                chainId: 2741,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=2741",
                    browserURL: "https://abscan.org/",
                },
            },
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

    solidity: { version: "0.8.24" },
};

export default config;
