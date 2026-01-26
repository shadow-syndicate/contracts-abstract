import { subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_READ_FILE } from "hardhat/builtin-tasks/task-names";
import path from "path";
import { getConfig } from "../deploy/config-env";

/**
 * Hardhat plugin that patches VotingEscrow constants for testnet builds.
 *
 * When network is testnet (abstractTestnet, bscTestnet, hardhat):
 * - WEEK: 1 weeks (604800) -> 1 minute (60)
 * - MAXTIME: 4 years (126144000) -> 15 minutes (900)
 *
 * Determined automatically from DEPLOY_ENV config.
 */

let isTestnet = false;
try {
    const config = getConfig();
    isTestnet = config.network.includes('Testnet') || config.network === 'hardhat';
} catch {
    // getConfig() throws if DEPLOY_ENV not set - default to false (production)
}

if (isTestnet) {
    console.log("🔧 VotingEscrow TESTNET mode enabled - patching constants");
}

subtask(TASK_COMPILE_SOLIDITY_READ_FILE)
    .setAction(async ({ absolutePath }: { absolutePath: string }, hre, runSuper) => {
        const content = await runSuper({ absolutePath });

        if (!isTestnet) {
            return content;
        }

        const filename = path.basename(absolutePath);
        if (filename !== "VotingEscrow.sol") {
            return content;
        }

        console.log(`  📝 Patching ${filename} for testnet...`);

        let patched = content;

        // Patch WEEK constant: 1 weeks -> 1 minute
        patched = patched.replace(
            "uint internal constant WEEK = 1 weeks;",
            "uint internal constant WEEK = 1 minutes;"
        );

        // Patch MAXTIME constant: 4 * 365 * 86400 -> 15 minutes
        patched = patched.replace(
            "uint internal constant MAXTIME = 4 * 365 * 86400;",
            "uint internal constant MAXTIME = 15 minutes;"
        );

        // Patch iMAXTIME constant: 4 * 365 * 86400 -> 900 (15 minutes in seconds)
        patched = patched.replace(
            "int128 internal constant iMAXTIME = 4 * 365 * 86400;",
            "int128 internal constant iMAXTIME = 900;"
        );

        return patched;
    });
