import { Deployer } from "@matterlabs/hardhat-zksync";
import { Wallet } from "zksync-ethers";
import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contract, Interface, Signer } from "ethers";
import { getDeployerPrivateKey } from "../config-env";

// Re-export for backward compatibility
export { getDeployerPrivateKey };

export function isZkSyncNetwork(hre: HardhatRuntimeEnvironment): boolean {
    return hre.network.config.zksync === true;
}

export function sleep(timeMs: number) {
    return new Promise(resolve => setTimeout(resolve, timeMs));
}

export async function verifyContract(address: string, args: any[], hre: HardhatRuntimeEnvironment, contractPath?: string) {
    console.log(`Verifying contract at ${address}${contractPath ? ` (${contractPath})` : ''}...`);

    // Wait for contract to be indexed
    console.log("Waiting 10 seconds for contract to be indexed...");
    await sleep(10000);

    // For EVM networks, use CLI to bypass zksync-verify plugin interference
    if (!isZkSyncNetwork(hre)) {
        const { execSync } = require('child_process');

        // Build verification command
        let cmd = `npx hardhat verify --config hardhat.config.evm.ts --network ${hre.network.name}`;
        if (contractPath) {
            cmd += ` --contract ${contractPath}`;
        }
        cmd += ` ${address}`;

        // Add constructor arguments
        for (const arg of args) {
            if (typeof arg === 'string') {
                cmd += ` "${arg}"`;
            } else {
                cmd += ` "${String(arg)}"`;
            }
        }

        console.log(`Running: ${cmd}`);

        try {
            execSync(cmd, {
                stdio: 'inherit',
                env: { ...process.env }
            });
            console.log("✅ Contract verified successfully");
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            if (errorMessage.toLowerCase().includes("already verified")) {
                console.log("✅ Contract already verified.");
            } else {
                console.log(`⚠️  Verification failed. Contract deployed but not verified.`);
            }
        }
        return;
    }

    // For zkSync networks, use programmatic verification
    let attempts = 0;
    const maxAttempts = 3;

    for (;;) {
        try {
            const verifyArgs: any = {
                address: address,
                constructorArguments: args,
            };
            if (contractPath) {
                verifyArgs.contract = contractPath;
            }
            await hre.run("verify:verify", verifyArgs);
            console.log("✅ Contract verified successfully");
            break;
        } catch (e) {
            attempts++;
            const errorMessage = e instanceof Error ? e.message : String(e);
            const errorName = e instanceof Error ? e.constructor.name : '';

            // Skip if already verified (handles both V1 and V2 API responses)
            if (errorMessage.toLowerCase().includes("already verified") ||
                errorName === "ContractAlreadyVerifiedError") {
                console.log("✅ Contract already verified, skipping verification.");
                break;
            }

            console.error(`Verification attempt ${attempts} failed:`, e);

            if (attempts >= maxAttempts) {
                console.log(`⚠️  Skipping verification after ${maxAttempts} attempts. Contract deployed successfully but not verified.`);
                break;
            }

            console.log(`Waiting 6 seconds before retry...`);
            await sleep(6000);
        }
    }
}

// Artifact with interface for encoding function calls
export interface LoadedArtifact {
    interface: Interface;
    deploy(args: any[]): Promise<Contract>;
}

// Universal deployer interface
export interface UniversalDeployer {
    getAddress(): Promise<string>;
    getSigner(): Signer;
    deploy(artifact: string, args: any[]): Promise<Contract>;
    loadArtifact(artifact: string): Promise<LoadedArtifact>;
}

// Create universal deployer based on network type
export async function createDeployer(hre: HardhatRuntimeEnvironment): Promise<UniversalDeployer> {
    if (isZkSyncNetwork(hre)) {
        // zkSync network - use zkSync deployer
        const wallet = new Wallet(getDeployerPrivateKey());
        const deployer = new Deployer(hre, wallet);
        return {
            getAddress: () => wallet.getAddress(),
            getSigner: () => deployer.zkWallet as unknown as Signer,
            deploy: async (artifact: string, args: any[]) => {
                const contract = await deployer.deploy(await deployer.loadArtifact(artifact), args);
                return contract as unknown as Contract;
            },
            loadArtifact: async (artifact: string) => {
                const loadedArtifact = await deployer.loadArtifact(artifact);
                return {
                    interface: new Interface(loadedArtifact.abi),
                    deploy: async (args: any[]) => {
                        const contract = await deployer.deploy(loadedArtifact, args);
                        return contract as unknown as Contract;
                    }
                };
            }
        };
    } else {
        // EVM network - use ethers
        const [signer] = await ethers.getSigners();
        return {
            getAddress: () => signer.getAddress(),
            getSigner: () => signer,
            deploy: async (artifact: string, args: any[]) => {
                const factory = await ethers.getContractFactory(artifact);
                const contract = await factory.deploy(...args);
                await contract.waitForDeployment();
                return contract as Contract;
            },
            loadArtifact: async (artifact: string) => {
                const factory = await ethers.getContractFactory(artifact);
                return {
                    interface: factory.interface,
                    deploy: async (args: any[]) => {
                        const contract = await factory.deploy(...args);
                        await contract.waitForDeployment();
                        return contract as Contract;
                    }
                };
            }
        };
    }
}

export async function deployOnly(artifact: string, args: any[], deployer: UniversalDeployer) {
    const contract = await deployer.deploy(artifact, args);
    console.log("Deployed", artifact, "at", await contract.getAddress());
    return contract;
}

export async function deployAndVerify(artifact: string, args: any[], deployer: UniversalDeployer, hre: HardhatRuntimeEnvironment, contractPath?: string) {
    const contract = await deployer.deploy(artifact, args);
    console.log("Deployed", artifact, "at", await contract.getAddress());

    await verifyContract(await contract.getAddress(), args, hre, contractPath);

    return contract;
}
