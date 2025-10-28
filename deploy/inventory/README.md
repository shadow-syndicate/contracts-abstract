# Inventory Timelock Upgrade Process

This folder contains scripts for managing Inventory contract upgrades through TimelockController for added security.

## Overview

The TimelockController adds a mandatory delay between proposing and executing upgrades, providing:
- Time for review and detection of malicious upgrades
- Opportunity to cancel unauthorized upgrades
- Transparent governance with on-chain proposal tracking

## Setup (One-time)

### 1. Transfer Admin Role to Timelock

After deploying Inventory and TimelockController, transfer admin control:

```bash
DEPLOY_ENV=dev \
INVENTORY_ADDRESS=0x... \
TIMELOCK_ADDRESS=0x... \
npx hardhat deploy-zksync --script inventory/transfer-admin-to-timelock.ts --network abstractTestnet
```

**Important:** Do NOT renounce the deployer's admin role until you've verified the timelock works correctly!

## Upgrade Process

### Step 1: Schedule the Upgrade

Deploy new implementation and schedule the upgrade in TimelockController:

```bash
DEPLOY_ENV=dev \
INVENTORY_ADDRESS=0x... \
TIMELOCK_ADDRESS=0x... \
npx hardhat deploy-zksync --script inventory/upgrade-inventory-via-timelock.ts --network abstractTestnet
```

This will:
1. Deploy the new Inventory implementation
2. Verify the implementation contract
3. Schedule the upgrade in TimelockController
4. Save execution parameters to `timelock-upgrade-params.json`

**Output:**
- New implementation address
- Operation ID
- Execution timestamp (current time + timelock delay)

### Step 2: Wait for Timelock Delay

The upgrade cannot be executed until the timelock delay has passed.

**Delay times by environment:**
- **dev**: 5 minutes
- **dev3**: 5 minutes
- **dan**: 5 minutes
- **prod**: 7 days ⚠️

### Step 3: Execute the Upgrade

After the delay period:

```bash
TIMELOCK_ADDRESS=0x... \
npx hardhat deploy-zksync --script inventory/execute-timelock-upgrade.ts --network abstractTestnet
```

This will:
1. Check if the operation is ready
2. Execute the upgrade transaction
3. Test the new implementation
4. Clean up the parameters file

## Security Notes

### Who Can Execute?

With the default configuration:
- **Proposers**: Only specific addresses can schedule operations (set in config.ts)
- **Executors**: Empty array = anyone can execute after the delay
  - This is intentional for decentralization
  - The delay provides security, not access control

### Emergency Procedures

If you need to cancel a scheduled upgrade:

```javascript
// Get the operation ID from timelock-upgrade-params.json
const timelock = await ethers.getContractAt("TimelockController", TIMELOCK_ADDRESS);
await timelock.cancel(operationId);
```

### Revoking Timelock Control

To remove timelock control and regain direct upgrade access:

```javascript
const inventory = await ethers.getContractAt("Inventory", INVENTORY_ADDRESS);
const timelock = await ethers.getContractAt("TimelockController", TIMELOCK_ADDRESS);

// Must be executed through timelock itself!
await timelock.schedule(
  INVENTORY_ADDRESS,
  0,
  inventory.interface.encodeFunctionData("revokeRole", [DEFAULT_ADMIN_ROLE, TIMELOCK_ADDRESS]),
  ethers.ZeroHash,
  ethers.id("revoke-timelock"),
  await timelock.getMinDelay()
);

// Wait for delay, then execute
await timelock.execute(...);
```

## Files

- **transfer-admin-to-timelock.ts** - One-time setup to transfer admin role
- **upgrade-inventory-via-timelock.ts** - Schedule a new upgrade
- **execute-timelock-upgrade.ts** - Execute a scheduled upgrade
- **README.md** - This file

## Example Full Workflow

```bash
# 1. Deploy Inventory with TimelockController (first time only)
DEPLOY_ENV=dev npm run deploy-inventory

# 2. Transfer admin to timelock (first time only)
DEPLOY_ENV=dev \
INVENTORY_ADDRESS=0xYourInventoryProxy \
TIMELOCK_ADDRESS=0xYourTimelock \
npx hardhat deploy-zksync --script inventory/transfer-admin-to-timelock.ts --network abstractTestnet

# 3. When you need to upgrade:
DEPLOY_ENV=dev \
INVENTORY_ADDRESS=0xYourInventoryProxy \
TIMELOCK_ADDRESS=0xYourTimelock \
npx hardhat deploy-zksync --script inventory/upgrade-inventory-via-timelock.ts --network abstractTestnet

# 4. Wait for delay (5 mins for dev, 7 days for prod)

# 5. Execute the upgrade
TIMELOCK_ADDRESS=0xYourTimelock \
npx hardhat deploy-zksync --script inventory/execute-timelock-upgrade.ts --network abstractTestnet
```

## Troubleshooting

**"Operation not ready yet"**
- The timelock delay hasn't passed yet
- Check the execution timestamp in the error message

**"Operation not found"**
- The upgrade wasn't scheduled, or was already executed
- Check if `timelock-upgrade-params.json` exists

**"TimelockController: operation is not ready"**
- Transaction sent too early
- Wait a bit longer and retry

**"Caller is not a proposer"**
- Your address is not in the proposers list
- Check config.ts timelock.proposers array