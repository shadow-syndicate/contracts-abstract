import { vars } from "hardhat/config";

export interface DeployConfig {
    network: 'abstractTestnet' | 'abstractMainnet' | 'hardhat' | 'bscTestnet' | 'bscMainnet';
    admin: string[];
    signer: string;
    minter: string;
    withdraw: string;
    manager?: string;

    // Contract addresses - these should be updated after deployment
    contracts: {
        trax?: string;
        traxExchange?: string;
        inventoryProxy?: string;
        inventoryTimelock?: string;
        reactorProxy?: string;
        lootbox?: string;
        usdc?: string;
        shop?: string;
        roach?: string;
    };

    // Metadata URLs
    metadata: {
        inventory: string;
        inventoryContract: string;
        badges: string;
    };

    // Timelock configuration
    timelock: {
        minDelay: number; // in seconds
        proposers: string[];
        executors: string[]; // empty array means anyone can execute
    };

    // Reactor configuration (environment-specific)
    reactor: {
        batteryDurations: number[]; // in seconds
    };
}

const week = 7 * 24 * 60 * 60;

export const configs: Record<string, DeployConfig> = {
    prod: {
        network: 'abstractMainnet',
        admin: ['0x652A359448b8a6EDD17eFCc83Cc4C9f6201C27f6'],
        signer: '0x20000dC5611f4258cb9c0b0d0Da971cDba8b96a9',
        minter: '0x100000ec0732D3A7B69660aa85dBaDdd672879f0',
        withdraw: '0xF4D8df25C716871b3435189343D54B6A3558C4a0',
        manager: '0x652A359448b8a6EDD17eFCc83Cc4C9f6201C27f6',

        contracts: {
            trax: '0x7eDD91c4dd202032872BFbfcd3a4E4F71CB4B8bC',
            traxExchange: '0x341C67CB6b91Fb0b476860E8487DAc219E9D3369',
            inventoryProxy: '0xd6a99e97822e0dd82C211B8EB80d4FD45C88C3Db',
            inventoryTimelock: undefined,
            reactorProxy: '0x5714A3BB86Ff21e3F24Dc0EAF1afF351AEaCE101',
            lootbox: '0xA0f69095d2b31e9795e9923cD2a66Fa911CCd3cf',
            shop: '0xFD2e105E1dc31dF9A4301f22aA6cAd67C0FD1632',
            usdc: '0x84A71ccD554Cc1b02749b35d22F684CC8ec987e1',
        },

        metadata: {
            badges: 'https://beta.roachracingclub.com/api/metadata/badge/',
            inventory: 'https://beta.roachracingclub.com/api/metadata/inventory/',
            inventoryContract: 'https://beta.roachracingclub.com/api/metadata/inventory-contract',
        },

        timelock: {
            minDelay: 24 * 60 * 60, // 1 day
            proposers: ['0x3857CE692dd96f307d42A03Ac5F33DB2496cF82f'],
            executors: [],
        },

        reactor: {
            batteryDurations: [week, week, week, week],
        },
    },

};

/**
 * Get network name based on DEPLOY_ENV
 * Used by hardhat.config.ts to set defaultNetwork
 */
export function getNetworkName(): string {
    const env = process.env.DEPLOY_ENV || 'dev';
    const config = configs[env];
    if (!config) {
        return 'abstractTestnet';
    }
    return config.network;
}

/**
 * Get configuration for the current environment
 * Set DEPLOY_ENV environment variable to switch between environments
 * Example: DEPLOY_ENV=prod npx hardhat deploy-zksync --script deploy-inventory.ts
 */
export function getConfig(): DeployConfig {
    const env = process.env.DEPLOY_ENV || 'dev';
    const config = configs[env];

    if (!config) {
        throw new Error(`Unknown environment: ${env}. Available: ${Object.keys(configs).join(', ')}`);
    }

    console.log(`📝 Using ${env.toUpperCase()} configuration`);
    return config;
}

/**
 * Get deployer private key based on DEPLOY_ENV
 * Used by hardhat.config.ts and deploy scripts
 * Returns a dummy key if env is not set (for compile/build commands)
 */
export function getDeployerPrivateKey(): string {
    const env = process.env.DEPLOY_ENV;

    // If no DEPLOY_ENV set, return dummy key for hardhat config loading (compile, etc)
    if (!env) {
        return "0x0000000000000000000000000000000000000000000000000000000000000001";
    }

    const config = configs[env];

    if (!config) {
        throw new Error(`Unknown environment: ${env}. Available: ${Object.keys(configs).join(', ')}`);
    }

    // Production networks use separate env vars
    if (config.network === 'abstractMainnet') {
        const key = process.env.BETA_ABS_DEPLOYER_PRIVATE_KEY;
        if (!key) throw new Error("BETA_ABS_DEPLOYER_PRIVATE_KEY not set");
        return key;
    }

    if (config.network === 'bscMainnet') {
        const key = process.env.BSC_DEPLOYER_PRIVATE_KEY;
        if (!key) throw new Error("BSC_DEPLOYER_PRIVATE_KEY not set");
        return key;
    }

    // Dev/test networks use hardhat vars
    return vars.get("DEPLOYER_PRIVATE_KEY");
}
