import {HardhatUserConfig} from "hardhat/config";
import "@matterlabs/hardhat-zksync";
import generated from "@nomicfoundation/hardhat-verify";

const config: HardhatUserConfig = {
    zksolc: {
        version: "1.5.7", // Ensure version is 1.5.7!
        settings: {
            // Note: This must be true to call NonceHolder & ContractDeployer system contracts
            enableEraVMExtensions: false,
        },
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
        hardhat: {
            chainId: 1337, // Use a standard chain ID for Hardhat's local network
        },
    },
    etherscan: {
        apiKey: {
            abstractTestnet: "TACK2D1RGYX9U7MC31SZWWQ7FCWRYQ96AD",
            abstractMainnet: "6WWRXTCBGGABICQ8SSAW1IY4C6YH1PQ78P",
        },
        customChains: [
            {
                network: "abstractTestnet",
                chainId: 11124,
                urls: {
                    apiURL: "https://api-sepolia.abscan.org/api",
                    browserURL: "https://sepolia.abscan.org/",
                },
            },
            {
                network: "abstractMainnet",
                chainId: 2741,
                urls: {
                    apiURL: "https://api.abscan.org/api",
                    browserURL: "https://abscan.org/",
                },
            },
        ],
    },
    solidity: {
        version: "0.8.24",
    },
};

export default config;
