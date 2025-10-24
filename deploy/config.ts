export interface DeployConfig {
    admin: string;
    signer: string;
    minter1: string;

    // Contract addresses - these should be updated after deployment
    contracts: {
        trax?: string;
        traxExchange?: string;
        inventory?: string;
        lootbox?: string;
        usdc?: string;
        manager?: string;
    };

    // Metadata URLs
    metadata: {
        inventory: string;
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

export const configs: Record<string, DeployConfig> = {
     prod: {
        admin: '0x3857CE692dd96f307d42A03Ac5F33DB2496cF82f',
        signer: '0x44443591DF7f924e5efF6333C04398dfB143a6DA',
        minter1: '0x1000A44f97F6fd5AceF9d26c7BC4112288588498',

        contracts: {
            trax: '0x86C57EA97Ee1a067DA488eF13820c2da7602F8e8',
            traxExchange: undefined,
            inventory: undefined,
            lootbox: undefined,
            usdc: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', // mainnet USDC
            manager: undefined,
        },

        metadata: {
            inventory: 'https://api.roachracingclub.com/metadata/inventory/',
            badges: 'https://api.roachracingclub.com/metadata/badge/',
        },

        timelock: {
            minDelay: 7 * 24 * 60 * 60, // 7 days
            proposers: ['0x3857CE692dd96f307d42A03Ac5F33DB2496cF82f'],
            executors: [],
        },

        reactor: {
            batteryDurations: [5 * 60, 15 * 60, 60 * 60, 60 * 60], // 5 mins, 15 mins, 60 mins, 60 mins
        },
    },
};

// Role hashes (these are constant across all environments)
export const ROLES = {
    DEFAULT_ADMIN_ROLE: '0x0000000000000000000000000000000000000000000000000000000000000000',
    WITHDRAW_ROLE: '0x5d8e12c39142ff96d79d04d15d1ba1269e4fe57bb9d26f43523628b34ba108ec',
    MINTER_ROLE: '0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6',
    BURNER_ROLE: '0x9667e80708b6eeeb0053fa0cca44e028ff548e2a9f029edfeac87c118b08b7c8',
    REFUND_ROLE: '0xf1f91cdf1f18aaac45ca4aaddade87aabc2746f6d044da7cf8544558c5776172',
    MANAGER_ROLE: '0x241ecf16d79d0f8dbfb92cbc07fe17840425976cf0667f022fe9877caa831b08',
};

// Reactor configuration (shared across all environments, except batteryDurations which is per-env)
export const REACTOR_CONFIG = {
    batteryItemIds: [1000, 1010, 1100, 1900],
    minReactorId: 2000,
    maxReactorId: 20000,
    reactorIdStep: 1000,
    activationCount: 4,
};

// Shop lots configuration (shared across all environments)
export const SHOP_LOTS = [
    {
        lotId: 1,
        priceInTrax: "100",
        priceInTraxTurbo: "0", // free for lootbox holders
        itemIds: (config: typeof REACTOR_CONFIG) => [config.minReactorId, config.batteryItemIds[0]],
        amounts: [1, 4],
        restrictedItems: (config: typeof REACTOR_CONFIG) => [
            config.minReactorId,
            config.minReactorId + 1,
            config.minReactorId + 2,
            config.minReactorId + 3,
            config.minReactorId + 4
        ]
    },
    {
        lotId: 2,
        priceInTrax: "20",
        priceInTraxTurbo: "14", // 30% discount
        itemIds: (config: typeof REACTOR_CONFIG) => [config.minReactorId],
        amounts: [1],
        restrictedItems: (config: typeof REACTOR_CONFIG) => [
            config.minReactorId,
            config.minReactorId + 1,
            config.minReactorId + 2,
            config.minReactorId + 3,
            config.minReactorId + 4
        ]
    },
    {
        lotId: 3,
        priceInTrax: "10",
        priceInTraxTurbo: "7", // 30% discount
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[0]],
        amounts: [1],
        restrictedItems: () => []
    },
    {
        lotId: 4,
        priceInTrax: "100",
        priceInTraxTurbo: "70", // 30% discount
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[1]],
        amounts: [1],
        restrictedItems: () => []
    },
    {
        lotId: 5,
        priceInTrax: "1000",
        priceInTraxTurbo: "700", // 30% discount
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[2]],
        amounts: [1],
        restrictedItems: () => []
    },
    {
        lotId: 6,
        priceInTrax: "20",
        priceInTraxTurbo: "14", // 30% discount
        itemIds: (config: typeof REACTOR_CONFIG) => [config.minReactorId + config.reactorIdStep],
        amounts: [1],
        restrictedItems: (config: typeof REACTOR_CONFIG) => [
            config.minReactorId + config.reactorIdStep,
            config.minReactorId + config.reactorIdStep + 1,
            config.minReactorId + config.reactorIdStep + 2,
            config.minReactorId + config.reactorIdStep + 3,
            config.minReactorId + config.reactorIdStep + 4
        ]
    }
];

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
