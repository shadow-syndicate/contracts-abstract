import { Wallet, Provider, Contract } from "zksync-ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "ethers";
import { getDeployerPrivateKey } from "../utils/deployUtils";

// Token addresses on Abstract Testnet
const USDC_ADDRESS = "0x855267887b95FB599DD792397A63913426a14E7e";
const ERC20_ADDRESS = "0xC687Dab1a333E03110838E243a1D300Ab732BC9f";

// Uniswap V3 contracts on Abstract Testnet
const POSITION_MANAGER_ADDRESS = "0x069f199763c045A294C7913E64bA80E5F362A5d7";
const FACTORY_ADDRESS = "0x2E17FF9b877661bDFEF8879a4B31665157a960F0";

// Token decimals
const USDC_DECIMALS = 6;
const ERC20_DECIMALS = 18;

// Price: 1 ERC20 = 0.09 USDC
const PRICE_ERC20_IN_USDC = 0.09;

// Fee tier: 0.05% (500) - for stable/correlated pairs
const FEE = 500;

// Liquidity amounts to add (in human-readable units)
const ERC20_AMOUNT = "1000000"; // 1M ERC20 tokens
const USDC_AMOUNT = "90000"; // 90K USDC (1M * 0.09)

// ERC20 minimal ABI for mint and approve
const ERC20_ABI = [
    "function mint(address to, uint256 amount) external",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)",
];

// Uniswap V3 NonfungiblePositionManager ABI (minimal)
const POSITION_MANAGER_ABI = [
    "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
    "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
];

// Factory ABI
const FACTORY_ABI = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

/**
 * Calculate sqrtPriceX96 for Uniswap V3
 *
 * In Uniswap V3:
 * - price = token1 / token0 (in raw units, considering decimals)
 * - sqrtPriceX96 = sqrt(price) * 2^96
 *
 * Token ordering: token0 < token1 by address
 */
function calculateSqrtPriceX96(
    token0Address: string,
    token1Address: string,
    token0Decimals: number,
    token1Decimals: number,
    priceToken1InToken0: number // How much token0 for 1 token1
): bigint {
    // Uniswap V3 price = token1_amount / token0_amount in raw units
    // If price is "1 ERC20 = 0.09 USDC" and token0=USDC, token1=ERC20:
    // We need price = ERC20_raw / USDC_raw for 0.09 USDC worth of ERC20

    // price = (1 * 10^18) / (0.09 * 10^6) = 10^18 / (9 * 10^4) = 10^14 / 9

    const Q96 = 2n ** 96n;

    // Calculate price with high precision
    // price = token1_amount_raw / token0_amount_raw
    // For 1 token1 = priceToken1InToken0 token0:
    // token1_raw = 1 * 10^token1Decimals
    // token0_raw = priceToken1InToken0 * 10^token0Decimals
    // price = token1_raw / token0_raw

    const token1Raw = 10n ** BigInt(token1Decimals);
    const token0Raw = BigInt(Math.floor(priceToken1InToken0 * 10 ** token0Decimals));

    // price = token1Raw / token0Raw
    // sqrtPrice = sqrt(price)
    // sqrtPriceX96 = sqrtPrice * 2^96

    // To maintain precision: sqrtPriceX96 = sqrt(token1Raw / token0Raw) * 2^96
    // = sqrt(token1Raw * 2^192 / token0Raw)

    const numerator = token1Raw * Q96 * Q96;
    const denominator = token0Raw;
    const ratio = numerator / denominator;

    // Calculate integer square root
    return sqrt(ratio);
}

/**
 * Integer square root using Newton's method
 */
function sqrt(value: bigint): bigint {
    if (value < 0n) throw new Error("Square root of negative number");
    if (value === 0n) return 0n;

    let x = value;
    let y = (x + 1n) / 2n;

    while (y < x) {
        x = y;
        y = (x + value / x) / 2n;
    }

    return x;
}

/**
 * Get tick range for full range liquidity
 * For fee = 3000 (0.3%), tick spacing = 60
 */
function getFullRangeTickBounds(fee: number): { tickLower: number; tickUpper: number } {
    const tickSpacing = fee === 500 ? 10 : fee === 3000 ? 60 : fee === 10000 ? 200 : 60;

    // Max tick for Uniswap V3
    const MAX_TICK = 887272;

    // Round to nearest tick spacing
    const tickLower = Math.ceil(-MAX_TICK / tickSpacing) * tickSpacing;
    const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;

    return { tickLower, tickUpper };
}

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`\n🦄 Creating Uniswap V3 Pool on Abstract Testnet\n`);

    // Initialize provider and wallet
    const provider = new Provider("https://api.testnet.abs.xyz");
    const wallet = new Wallet(getDeployerPrivateKey(hre), provider);

    console.log(`Wallet address: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`ETH balance: ${ethers.formatEther(balance)} ETH`);

    // Initialize contracts
    const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, wallet);
    const erc20 = new Contract(ERC20_ADDRESS, ERC20_ABI, wallet);
    const positionManager = new Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, wallet);
    const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet);

    // Get token info
    const usdcSymbol = await usdc.symbol();
    const erc20Symbol = await erc20.symbol();
    console.log(`\nTokens:`);
    console.log(`  ${usdcSymbol}: ${USDC_ADDRESS} (${USDC_DECIMALS} decimals)`);
    console.log(`  ${erc20Symbol}: ${ERC20_ADDRESS} (${ERC20_DECIMALS} decimals)`);

    // Determine token0 and token1 (sorted by address)
    const [token0, token1, token0Decimals, token1Decimals, amount0, amount1] =
        USDC_ADDRESS.toLowerCase() < ERC20_ADDRESS.toLowerCase()
            ? [USDC_ADDRESS, ERC20_ADDRESS, USDC_DECIMALS, ERC20_DECIMALS, USDC_AMOUNT, ERC20_AMOUNT]
            : [ERC20_ADDRESS, USDC_ADDRESS, ERC20_DECIMALS, USDC_DECIMALS, ERC20_AMOUNT, USDC_AMOUNT];

    const isUsdcToken0 = token0 === USDC_ADDRESS;
    console.log(`\nToken ordering (by address):`);
    console.log(`  token0: ${isUsdcToken0 ? usdcSymbol : erc20Symbol} (${token0})`);
    console.log(`  token1: ${isUsdcToken0 ? erc20Symbol : usdcSymbol} (${token1})`);

    // Calculate sqrtPriceX96
    // Price: 1 ERC20 = 0.09 USDC
    // If USDC is token0: price = ERC20/USDC = 1/0.09 = 11.11... (but in raw units with decimals)
    // If ERC20 is token0: price = USDC/ERC20 = 0.09 (but in raw units with decimals)

    const priceToken1InToken0 = isUsdcToken0
        ? PRICE_ERC20_IN_USDC      // 1 ERC20 = 0.09 USDC
        : 1 / PRICE_ERC20_IN_USDC; // 1 USDC = 11.11 ERC20

    const sqrtPriceX96 = calculateSqrtPriceX96(
        token0,
        token1,
        token0Decimals,
        token1Decimals,
        priceToken1InToken0
    );

    console.log(`\nPrice configuration:`);
    console.log(`  1 ${erc20Symbol} = ${PRICE_ERC20_IN_USDC} ${usdcSymbol}`);
    console.log(`  sqrtPriceX96: ${sqrtPriceX96.toString()}`);
    console.log(`  Fee tier: ${FEE / 10000}%`);

    // Check if pool already exists
    const existingPool = await factory.getPool(token0, token1, FEE);
    if (existingPool !== ethers.ZeroAddress) {
        console.log(`\n⚠️ Pool already exists at: ${existingPool}`);
        console.log(`Skipping pool creation, will only add liquidity if needed.`);
    }

    // Step 1: Mint tokens
    console.log(`\n📦 Step 1: Minting tokens...`);

    const usdcAmountRaw = ethers.parseUnits(USDC_AMOUNT, USDC_DECIMALS);
    const erc20AmountRaw = ethers.parseUnits(ERC20_AMOUNT, ERC20_DECIMALS);

    console.log(`  Minting ${USDC_AMOUNT} ${usdcSymbol}...`);
    const mintUsdcTx = await usdc.mint(wallet.address, usdcAmountRaw);
    await mintUsdcTx.wait();
    console.log(`  ✅ Minted ${usdcSymbol}`);

    console.log(`  Minting ${ERC20_AMOUNT} ${erc20Symbol}...`);
    const mintErc20Tx = await erc20.mint(wallet.address, erc20AmountRaw);
    await mintErc20Tx.wait();
    console.log(`  ✅ Minted ${erc20Symbol}`);

    // Check balances
    const usdcBalance = await usdc.balanceOf(wallet.address);
    const erc20Balance = await erc20.balanceOf(wallet.address);
    console.log(`\n  Balances after mint:`);
    console.log(`    ${usdcSymbol}: ${ethers.formatUnits(usdcBalance, USDC_DECIMALS)}`);
    console.log(`    ${erc20Symbol}: ${ethers.formatUnits(erc20Balance, ERC20_DECIMALS)}`);

    // Step 2: Approve tokens
    console.log(`\n🔓 Step 2: Approving tokens for Position Manager...`);

    console.log(`  Approving ${usdcSymbol}...`);
    const approveUsdcTx = await usdc.approve(POSITION_MANAGER_ADDRESS, usdcAmountRaw);
    await approveUsdcTx.wait();
    console.log(`  ✅ Approved ${usdcSymbol}`);

    console.log(`  Approving ${erc20Symbol}...`);
    const approveErc20Tx = await erc20.approve(POSITION_MANAGER_ADDRESS, erc20AmountRaw);
    await approveErc20Tx.wait();
    console.log(`  ✅ Approved ${erc20Symbol}`);

    // Step 3: Create and initialize pool
    console.log(`\n🏊 Step 3: Creating and initializing pool...`);

    if (existingPool === ethers.ZeroAddress) {
        const createPoolTx = await positionManager.createAndInitializePoolIfNecessary(
            token0,
            token1,
            FEE,
            sqrtPriceX96
        );
        const receipt = await createPoolTx.wait();
        console.log(`  ✅ Pool created! Tx: ${receipt.hash}`);

        const poolAddress = await factory.getPool(token0, token1, FEE);
        console.log(`  Pool address: ${poolAddress}`);
    }

    // Step 4: Add liquidity
    console.log(`\n💧 Step 4: Adding liquidity...`);

    const { tickLower, tickUpper } = getFullRangeTickBounds(FEE);
    console.log(`  Tick range: ${tickLower} to ${tickUpper}`);

    const amount0Desired = isUsdcToken0 ? usdcAmountRaw : erc20AmountRaw;
    const amount1Desired = isUsdcToken0 ? erc20AmountRaw : usdcAmountRaw;

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

    const mintParams = {
        token0,
        token1,
        fee: FEE,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min: 0, // Set to 0 for simplicity, in production use slippage protection
        amount1Min: 0,
        recipient: wallet.address,
        deadline,
    };

    console.log(`  Adding liquidity...`);
    console.log(`    amount0Desired: ${ethers.formatUnits(amount0Desired, token0Decimals)}`);
    console.log(`    amount1Desired: ${ethers.formatUnits(amount1Desired, token1Decimals)}`);

    const mintTx = await positionManager.mint(mintParams);
    const mintReceipt = await mintTx.wait();
    console.log(`  ✅ Liquidity added! Tx: ${mintReceipt.hash}`);

    // Final summary
    const finalPoolAddress = await factory.getPool(token0, token1, FEE);
    console.log(`\n✅ Summary:`);
    console.log(`  Pool: ${finalPoolAddress}`);
    console.log(`  Fee: ${FEE / 10000}%`);
    console.log(`  Price: 1 ${erc20Symbol} = ${PRICE_ERC20_IN_USDC} ${usdcSymbol}`);
    console.log(`  Liquidity added:`);
    console.log(`    ${USDC_AMOUNT} ${usdcSymbol}`);
    console.log(`    ${ERC20_AMOUNT} ${erc20Symbol}`);
}