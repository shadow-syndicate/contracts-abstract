import { HardhatUserConfig } from "hardhat/config";
import "@matterlabs/hardhat-zksync";              // keep this
import "@nomicfoundation/hardhat-verify";         // use this for Etherscan V2

const config: HardhatUserConfig = {
    zksolc: {
        version: "1.5.15",
        settings: { enableEraVMExtensions: false },
    },

    defaultNetwork: "abstractTestnet",

    networks: {
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
    },

    // Etherscan V2 config + customChains mapping to your network names
    etherscan: {
        apiKey: {
            abstractTestnet: process.env.ABS_ETHERSCAN_API_KEY || "",
            abstractMainnet: process.env.ABS_ETHERSCAN_API_KEY || "",
        },
        customChains: [
            {
                network: "abstractTestnet",
                chainId: 11124,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api",   // V2 endpoint
                    browserURL: "https://sepolia.abscan.org/",
                },
            },
            {
                network: "abstractMainnet",
                chainId: 2741,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api",   // V2 endpoint
                    browserURL: "https://abscan.org/",
                },
            },
        ],
    },

    solidity: { version: "0.8.24" },
};

export default config;
