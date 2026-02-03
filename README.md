# Roach Racing Club smart contracts for Abstract Blockchain

This repository contains smart contracts for Abstract Blockchain.

## Contracts integration

[TRAX](contracts/TRAX.sol) is non-transferable ERC-20 token, that is race rewards. 
It can be used to purchase some game services. 

# Get a reward in TRAX

Every day any player has a chance to receive some TRAX reward.
After race is finished the server sends a transaction with `mint` function call to TRAX contract,
signing it using MINTER_ROLE. Mint function just adds balance to player's address.

# Use TRAX in purchases

When player wants to use TRAX for some game services (like roach slot unlock or 
finish charging process), player sends a request to server. Server generates an `id`
for this purchase scenario, stores it in database with additional metadata (player, service).
Player sends a transaction with `use(value, id)` function call on TRAX contract.
`Call` function takes payment in TRAX (burns tokens) and emits event `Used(id, value)`.
Server reads all `Used` events from TRAX contract, checks if `value` is enough, reads metadata from 
database and executes service purchase.

## Setup instruction

- [Hardhat](hardhat/deploy)
- [Ethers.js](clients/src/ethers.ts)
- [Viem](clients/src/viem.ts)

### Hardhat

1. Change directory into the `hardhat` folder and install the dependencies.

   ```bash
   npm install
   ```

This is the setup instructions for the smart contracts of this repository.

2. Compiling the contracts.

   ```bash
   npx hardhat compile
   ```

3. Create a new [Hardhat configuration variable](https://hardhat.org/hardhat-runner/docs/guides/configuration-variables) for your wallet private key.

   When prompted, enter the private key of the wallet you want to use to deploy the contract.
   It is strongly recommended to use a new wallet for this purpose.

   ```bash
   npx hardhat vars set WALLET_PRIVATE_KEY
   ```

4. Run the [deploy script](./deploy/deploy.ts) to deploy the smart contracts.

   ```bash
   npx hardhat deploy --script deploy/deploy-trax.ts
   ```
5. Verify sources

   [Verify docs](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify)

## Deploying to BSC

**Important:** When deploying to BSC networks (bscTestnet, bscMainnet), you **must** use `--config hardhat.config.evm.ts`:

```bash
DEPLOY_ENV=danBsc npx hardhat run deploy/deploy-voting-escrow.ts --config hardhat.config.evm.ts
```

### Why this matters

The main `hardhat.config.ts` (for zkSync) does **not enable the optimizer**, resulting in large bytecode:
- Without optimizer: ~32KB (exceeds BSC 24KB limit)
- With optimizer (runs: 200): ~18KB

### Deploy commands for BSC

```bash
# ROACH token
DEPLOY_ENV=danBsc npx hardhat run deploy/deploy-roach.ts --config hardhat.config.evm.ts

# ShopV2
DEPLOY_ENV=danBsc npx hardhat run deploy/deploy-shop-v2.ts --config hardhat.config.evm.ts

# VotingEscrow (includes VeArtProxy)
DEPLOY_ENV=danBsc npx hardhat run deploy/deploy-voting-escrow.ts --config hardhat.config.evm.ts
```

### Environments

| Environment | Network | Description |
|-------------|---------|-------------|
| `danBsc` | BSC testnet | Dan's test environment |
| `devBsc` | BSC testnet | Dev environment |
| `danAbs` | Abstract testnet | zkSync-based, no code size limit |
| `prodAbs` | Abstract mainnet | Production |

