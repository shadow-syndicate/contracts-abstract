export interface DeployConfig {
    admin: string[];
    signer: string;
    minter: string;
    withdraw: string;
    manager?: string;

    // Contract addresses - these should be updated after deployment
    contracts: {
        trax?: string;
        traxExchange?: string;
        inventory?: string;
        inventoryTimelock?: string;
        lootbox?: string;
        usdc?: string;
        shop?: string;
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
    PAUSER_ROLE: '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
};

// Reactor configuration (shared across all environments, except batteryDurations which is per-env)
export const REACTOR_CONFIG = {
    batteryItemIds: [1000, 1010, 1100, 1900],
    minReactorId: 2000,
    maxReactorId: 5000, // total 4 reactors
    reactorIdStep: 1000,
    activationCount: 4,
};

// Soulbound tokens (non-transferrable) - batteries and reactors
export const SOULBOUND_TOKENS: number[] = (() => {
    const tokens = [];

    // Battery tokens are soulbound
    tokens.push(...REACTOR_CONFIG.batteryItemIds);

    // All reactor IDs are soulbound (base and activated)
    for (let reactorId = REACTOR_CONFIG.minReactorId; reactorId <= REACTOR_CONFIG.maxReactorId; reactorId += REACTOR_CONFIG.reactorIdStep) {
        // Base reactor
        tokens.push(reactorId);
        // Activated reactors (+1, +2, +3, +4)
        for (let i = 1; i <= REACTOR_CONFIG.activationCount; i++) {
            tokens.push(reactorId + i);
        }
    }

    return tokens;
})();

// Inventory token limits (shared across all environments)
export const INVENTORY_TOKEN_LIMITS: Array<{
    tokenId: number;
    maxBalancePerOwner: number;
}> = (() => {
    const limits = [];

    // Limit all reactor IDs to 1 per owner (base and activated, batteries have no limit)
    for (let reactorId = REACTOR_CONFIG.minReactorId; reactorId <= REACTOR_CONFIG.maxReactorId; reactorId += REACTOR_CONFIG.reactorIdStep) {
        // Base reactor
        limits.push({tokenId: reactorId, maxBalancePerOwner: 1});
        // Activated reactors (+1, +2, +3, +4)
        for (let i = 1; i <= REACTOR_CONFIG.activationCount; i++) {
            limits.push({tokenId: reactorId + i, maxBalancePerOwner: 1});
        }
    }

    return limits;
})();

// Restricted items configuration - mutually exclusive reactor ownership
// Each reactor variant (2000, 2001, 2002, 2003, 2004) cannot be owned simultaneously
export const RESTRICTED_ITEMS: Array<{
    tokenId: number;
    restricted: number[];
}> = (() => {
    const restrictions = [];

    // For each reactor family, all variants are mutually exclusive
    for (let reactorId = REACTOR_CONFIG.minReactorId; reactorId <= REACTOR_CONFIG.maxReactorId; reactorId += REACTOR_CONFIG.reactorIdStep) {
        // Build array of all IDs in this reactor family
        const familyIds = [reactorId];
        for (let i = 1; i <= REACTOR_CONFIG.activationCount; i++) {
            familyIds.push(reactorId + i);
        }

        // For each ID in the family, restrict all other IDs
        for (const tokenId of familyIds) {
            const restricted = familyIds.filter(id => id !== tokenId);
            restrictions.push({ tokenId, restricted });
        }
    }

    return restrictions;
})();

// Shop lots configuration (shared across all environments)
export const SHOP_LOTS = [
    { // Reactor#1
        lotId: 1,
        priceInTrax: "70",
        priceInTraxTurbo: "50",
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
    { // Spark Cell#1
        lotId: 20,
        priceInTrax: "7",
        priceInTraxTurbo: "5",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[0]],
        amounts: [1],
        restrictedItems: () => []
    },
    { // Flux  Cell#2
        lotId: 21,
        priceInTrax: "70",
        priceInTraxTurbo: "50",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[1]],
        amounts: [1],
        restrictedItems: () => []
    },
    { // Quantum Cell#3
        lotId: 22,
        priceInTrax: "700",
        priceInTraxTurbo: "500",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[2]],
        amounts: [1],
        restrictedItems: () => []
    },
    { // Nova Cell#4
        lotId: 23,
        priceInTrax: "7000",
        priceInTraxTurbo: "5000",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[3]],
        amounts: [1],
        restrictedItems: () => []
    },
    { // 4x Flux Cell#2
        lotId: 24,
        priceInTrax: "200",
        priceInTraxTurbo: "150",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[1]],
        amounts: [4],
        restrictedItems: () => []
    },
    { // 4 Cells#3 (Quantum)
        lotId: 25,
        priceInTrax: "2000",
        priceInTraxTurbo: "1500",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[2]],
        amounts: [4],
        restrictedItems: () => []
    },
    { // 4 Cells#4 (Nova)
        lotId: 26,
        priceInTrax: "20000",
        priceInTraxTurbo: "15000",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[3]],
        amounts: [4],
        restrictedItems: () => []
    },
];

// Shop lot ID range (calculated from SHOP_LOTS)
export const SHOP_CONFIG = {
    minLotId: 1,
    maxLotId: Math.max(...SHOP_LOTS.map(lot => lot.lotId)),
};

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
