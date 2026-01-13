// Role hashes (these are constant across all environments)
export const ROLES = {
    DEFAULT_ADMIN_ROLE: '0x0000000000000000000000000000000000000000000000000000000000000000',
    WITHDRAW_ROLE: '0x5d8e12c39142ff96d79d04d15d1ba1269e4fe57bb9d26f43523628b34ba108ec',
    MINTER_ROLE: '0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6',
    BURNER_ROLE: '0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848',
    REFUND_ROLE: '0xf1f91cdf1f18aaac45ca4aaddade87aabc2746f6d044da7cf8544558c5776172',
    MANAGER_ROLE: '0x241ecf16d79d0f8dbfb92cbc07fe17840425976cf0667f022fe9877caa831b08',
    PAUSER_ROLE: '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
};

// Reactor configuration (shared across all environments, except batteryDurations which is per-env)
export const REACTOR_CONFIG = {
    batteryItemIds: [1000, 1010, 1100, 1900],
    batteryReactorOffsets: [0, 1, 2, 3],
    minReactorId: 2000,
    maxReactorId: 5000, // total 4 reactors
    reactorIdStep: 1000,
    activationCount: 4,
};

// Simple token configuration (tokenId < 1000)
export const SIMPLE_TOKENS: Record<number, { name: string; soulbound?: boolean; maxCount?: number }> = {
    105: { name: 'Pudgy Lootbox', soulbound: true, maxCount: 1 },
};

// Soulbound tokens (non-transferrable) - batteries and reactors
export const SOULBOUND_TOKENS: number[] = (() => {
    const tokens: number[] = [];

    // Simple tokens with soulbound flag
    for (const [tokenId, config] of Object.entries(SIMPLE_TOKENS)) {
        if (config.soulbound) {
            tokens.push(Number(tokenId));
        }
    }

    // Battery tokens are soulbound
    tokens.push(...REACTOR_CONFIG.batteryItemIds);

    // All reactor IDs are soulbound (base and activated)
    for (let reactorId = REACTOR_CONFIG.minReactorId; reactorId <= REACTOR_CONFIG.maxReactorId; reactorId += REACTOR_CONFIG.reactorIdStep) {
        // Base reactor
        tokens.push(reactorId);
        // Activated reactors (+1, +2, +3)
        for (let i = 1; i < REACTOR_CONFIG.activationCount; i++) {
            tokens.push(reactorId + i);
        }
        // Final activation variants based on battery type (2004+0, 2004+1, 2004+2, 2004+3)
        const maxActivationId = reactorId + REACTOR_CONFIG.activationCount;
        for (const offset of REACTOR_CONFIG.batteryReactorOffsets) {
            tokens.push(maxActivationId + offset);
        }
    }

    return tokens;
})();

// Inventory token limits (shared across all environments)
export const INVENTORY_TOKEN_LIMITS: Array<{
    tokenId: number;
    maxBalancePerOwner: number;
}> = (() => {
    const limits: Array<{ tokenId: number; maxBalancePerOwner: number }> = [];

    // Simple tokens with maxCount
    for (const [tokenId, config] of Object.entries(SIMPLE_TOKENS)) {
        if (config.maxCount !== undefined) {
            limits.push({ tokenId: Number(tokenId), maxBalancePerOwner: config.maxCount });
        }
    }

    // Limit all reactor IDs to 1 per owner (base and activated, batteries have no limit)
    for (let reactorId = REACTOR_CONFIG.minReactorId; reactorId <= REACTOR_CONFIG.maxReactorId; reactorId += REACTOR_CONFIG.reactorIdStep) {
        // Base reactor
        limits.push({tokenId: reactorId, maxBalancePerOwner: 1});
        // Activated reactors (+1, +2, +3)
        for (let i = 1; i < REACTOR_CONFIG.activationCount; i++) {
            limits.push({tokenId: reactorId + i, maxBalancePerOwner: 1});
        }
        // Final activation variants based on battery type (2004+0, 2004+1, 2004+2, 2004+3)
        const maxActivationId = reactorId + REACTOR_CONFIG.activationCount;
        for (const offset of REACTOR_CONFIG.batteryReactorOffsets) {
            limits.push({tokenId: maxActivationId + offset, maxBalancePerOwner: 1});
        }
    }

    return limits;
})();

// Restricted items configuration - mutually exclusive reactor ownership
// Each reactor variant (2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007) cannot be owned simultaneously
export const RESTRICTED_ITEMS: Array<{
    tokenId: number;
    restricted: number[];
}> = (() => {
    const restrictions = [];

    // For each reactor family, all variants are mutually exclusive
    for (let reactorId = REACTOR_CONFIG.minReactorId; reactorId <= REACTOR_CONFIG.maxReactorId; reactorId += REACTOR_CONFIG.reactorIdStep) {
        // Build array of all IDs in this reactor family
        const familyIds = [reactorId];
        // Add activated reactors (+1, +2, +3)
        for (let i = 1; i < REACTOR_CONFIG.activationCount; i++) {
            familyIds.push(reactorId + i);
        }
        // Add final activation variants based on battery type (2004+0, 2004+1, 2004+2, 2004+3)
        const maxActivationId = reactorId + REACTOR_CONFIG.activationCount;
        for (const offset of REACTOR_CONFIG.batteryReactorOffsets) {
            familyIds.push(maxActivationId + offset);
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
        restrictedItems: (config: typeof REACTOR_CONFIG) => {
            const restricted = [
                config.minReactorId,
                config.minReactorId + 1,
                config.minReactorId + 2,
                config.minReactorId + 3,
            ];
            // Add final activation variants
            const maxActivationId = config.minReactorId + config.activationCount;
            for (const offset of config.batteryReactorOffsets) {
                restricted.push(maxActivationId + offset);
            }
            return restricted;
        }
    },
    { // Reactor#2
        lotId: 2,
        priceInTrax: "70",
        priceInTraxTurbo: "50",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.minReactorId + config.reactorIdStep],
        amounts: [1],
        restrictedItems: (config: typeof REACTOR_CONFIG) => {
            const reactorIndex = 2;
            const offset = (reactorIndex - 1) * config.reactorIdStep;
            const restricted = [
                offset + config.minReactorId,
                offset + config.minReactorId + 1,
                offset + config.minReactorId + 2,
                offset + config.minReactorId + 3,
            ];
            // Add final activation variants
            const maxActivationId = offset + config.minReactorId + config.activationCount;
            for (const offset2 of config.batteryReactorOffsets) {
                restricted.push(maxActivationId + offset2);
            }
            return restricted;
        }
    },
    { // Reactor#3
        lotId: 3,
        priceInTrax: "70",
        priceInTraxTurbo: "50",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.minReactorId + 2 * config.reactorIdStep],
        amounts: [1],
        restrictedItems: (config: typeof REACTOR_CONFIG) => {
            const reactorIndex = 3;
            const offset = (reactorIndex - 1) * config.reactorIdStep;
            const restricted = [
                offset + config.minReactorId,
                offset + config.minReactorId + 1,
                offset + config.minReactorId + 2,
                offset + config.minReactorId + 3,
            ];
            // Add final activation variants
            const maxActivationId = offset + config.minReactorId + config.activationCount;
            for (const offset2 of config.batteryReactorOffsets) {
                restricted.push(maxActivationId + offset2);
            }
            return restricted;
        }
    },
    { // Spark Cell#1
        lotId: 20,
        priceInTrax: "7",
        priceInTraxTurbo: "5",
        itemIds: (config: typeof REACTOR_CONFIG) => [config.batteryItemIds[0]],
        amounts: [1],
        restrictedItems: () => []
    },
    { // Flux Cell#2
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
];

// Shop lot ID range (calculated from SHOP_LOTS)
export const SHOP_CONFIG = {
    minLotId: 1,
    maxLotId: Math.max(...SHOP_LOTS.map(lot => lot.lotId)),
};

// Re-export from config-env for convenience
export { getConfig, type DeployConfig } from './config-env';
