// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.0;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title GridleToken - Token handling functionality for Gridle game
/// @notice Handles ERC20 token deposits, claims, and refunds with signature verification
/// @dev Uses cryptographic signatures to authorize deposits and claims. Each order ID can only be processed once to prevent
///      double spending. Supports role-based refunds for tokens with deposit validation.
contract GridleToken is AccessControl {
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");
    bytes32 public constant REFUND_ROLE = keccak256("REFUND_ROLE");

    /// @notice Address used to verify deposit signatures
    address public signerAddress;

    /// @notice Address to receive automatic withdrawals when balance exceeds limits
    address public withdrawAddress;

    /// @notice Mapping to track processed order IDs to prevent double spending
    mapping(uint => bool) public processedOrders;

    /// @notice Mapping to track last deposited amount per account per token for refund validation
    /// @dev deposits[account][token] = amount
    mapping(address => mapping(address => uint256)) public deposits;

    /// @notice Minimum balance target as a percentage of systemBalance (in basis points)
    /// @dev Target balance after withdrawal = systemBalance * minReservesCoef / 10000
    /// @dev Example: 11000 = 110% means keep 110% of systemBalance
    uint256 public minReservesCoef;

    /// @notice Maximum balance threshold as a percentage of systemBalance (in basis points)
    /// @dev When balance exceeds systemBalance * maxReservesCoef / 10000, auto-withdrawal triggers
    /// @dev Example: 15000 = 150% means trigger withdrawal when balance > 150% of systemBalance
    uint256 public maxReservesCoef;

    /// @notice Absolute minimum reserves that must always be present per token
    /// @dev Used as a safety floor when systemBalance is very low or zero
    mapping(address => uint256) public minReserves;

    /// @notice Last processed signId per token to track order sequence
    /// @dev lastSignId[token] = signId
    mapping(address => uint256) public lastSignId;

    /// @notice Error thrown when a provided signature is invalid
    error WrongSignature();

    /// @notice Error thrown when an order has already been processed
    error OrderAlreadyProcessed();

    /// @notice Error thrown when a zero address is provided where not allowed
    error ZeroAddress();

    /// @notice Error thrown when reserved amount exceeds available balance
    error InsufficientBalance();

    /// @notice Error thrown when deadline has passed
    error DeadlineExpired();

    /// @notice Error thrown when refund amount exceeds deposit amount
    error InvalidRefundAmount();

    /// @notice Error thrown when min coefficient is not greater than 100%
    error MinCoefficientTooLow();

    /// @notice Error thrown when max coefficient is not greater than 100%
    error MaxCoefficientTooLow();

    /// @notice Error thrown when min coefficient exceeds max coefficient
    error InvalidCoefficientOrder();

    /// @notice Emitted when a successful ERC20 token deposit is made
    /// @param signId The unique identifier for the order
    /// @param depositor The address that made the deposit
    /// @param token The ERC20 token contract address
    /// @param amount The amount deposited
    event TokenDeposited(uint indexed signId, address indexed depositor, address indexed token, uint256 amount);

    /// @notice Emitted when a successful ERC20 token claim is made
    /// @param signId The unique identifier for the order
    /// @param account The address that claimed the tokens
    /// @param token The ERC20 token contract address
    /// @param amount The amount claimed
    event TokenClaimed(uint indexed signId, address indexed account, address indexed token, uint256 amount);

    /// @notice Emitted when ERC20 tokens are refunded to an account
    /// @param account The address that received the refund
    /// @param token The ERC20 token contract address
    /// @param amount The amount refunded
    event TokenRefunded(address indexed account, address indexed token, uint256 amount);

    /// @notice Emitted when automatic withdrawal occurs
    /// @param token The token address
    /// @param amount The amount automatically withdrawn
    /// @param recipient The address that received the withdrawal
    event AutoWithdrawal(address indexed token, uint256 amount, address indexed recipient);

    /// @notice Emitted when reserve coefficients are updated
    /// @param minReservesCoef The new minimum reserves coefficient
    /// @param maxReservesCoef The new maximum reserves coefficient
    event ReserveCoefficientsUpdated(uint256 minReservesCoef, uint256 maxReservesCoef);

    /// @notice Emitted when minimum reserves are updated for a token
    /// @param token The token address
    /// @param minReserves The new minimum reserves amount
    event MinReservesUpdated(address indexed token, uint256 minReserves);

    /// @notice Emitted when ERC20 tokens are withdrawn from the contract
    /// @param withdrawer The address that performed the withdrawal
    /// @param token The ERC20 token contract address
    /// @param amount The amount withdrawn
    /// @param reserved The amount left reserved in the contract
    event TokenWithdrawn(address indexed withdrawer, address indexed token, uint256 amount, uint256 reserved);

    /// @notice Emitted when tokens are sent directly to the contract for topup
    /// @param sender The address that sent tokens to the contract
    /// @param token The token contract address
    /// @param amount The amount sent
    event Topup(address indexed sender, address indexed token, uint256 amount);

    /// @param defaultAdmin The address that will initially own the admin role
    /// @param _signerAddress The address authorized to sign deposit approvals
    constructor(address defaultAdmin, address _signerAddress) {
        if (defaultAdmin == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(WITHDRAW_ROLE, defaultAdmin);
        _grantRole(REFUND_ROLE, defaultAdmin);
        signerAddress = _signerAddress;
        withdrawAddress = defaultAdmin;

        // Set default reserve coefficients: min 110%, max 120%
        // Must be > 100% (10000) to maintain reserves above systemBalance
        minReservesCoef = 11000;  // 110% (11000/10000)
        maxReservesCoef = 12000;  // 120% (12000/10000)
    }

    /// @notice Allows an admin to update the authorized signer address
    /// @param newSigner The new signer address
    function setSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        signerAddress = newSigner;
    }

    /// @notice Set minimum and maximum reserve coefficients
    /// @param _minReservesCoef The minimum reserves coefficient in basis points (10000 = 100%)
    /// @param _maxReservesCoef The maximum reserves coefficient in basis points (10000 = 100%)
    function setReserveCoefficients(uint256 _minReservesCoef, uint256 _maxReservesCoef) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_minReservesCoef <= 10000) {
            revert MinCoefficientTooLow();
        }
        if (_maxReservesCoef <= 10000) {
            revert MaxCoefficientTooLow();
        }
        if (_minReservesCoef > _maxReservesCoef) {
            revert InvalidCoefficientOrder();
        }
        minReservesCoef = _minReservesCoef;
        maxReservesCoef = _maxReservesCoef;
        emit ReserveCoefficientsUpdated(_minReservesCoef, _maxReservesCoef);
    }

    /// @notice Set the address to receive automatic withdrawals
    /// @param _withdrawAddress The address to receive automatic withdrawals
    function setWithdrawAddress(address _withdrawAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_withdrawAddress == address(0)) {
            revert ZeroAddress();
        }
        withdrawAddress = _withdrawAddress;
    }

    /// @notice Set absolute minimum reserves for a token that must always be present
    /// @param token The token address
    /// @param _minReserves The minimum amount that must always be in the contract
    function setMinReserves(address token, uint256 _minReserves) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minReserves[token] = _minReserves;
        emit MinReservesUpdated(token, _minReserves);
    }

    /// @notice Internal function to handle automatic withdrawals when balance exceeds limits
    /// @param token The token address
    /// @param systemBalance The required system balance (funds needed for operations)
    function _autoWithdrawToken(address token, uint256 systemBalance) internal {
        // Calculate the total balance targets using coefficients
        // Example: if systemBalance = 100 tokens and minReservesCoef = 11000 (110%)
        // then minTargetFromCoef = 110 tokens (keeping 110% of what's needed)
        uint256 minTargetFromCoef = (systemBalance * minReservesCoef) / 10000;
        uint256 maxTargetFromCoef = (systemBalance * maxReservesCoef) / 10000;

        // Ensure we keep at least the coefficient-based target OR systemBalance + absolute minimum
        // This provides a safety floor: either percentage-based or fixed minimum buffer
        uint256 effectiveMinTarget = minTargetFromCoef > (systemBalance + minReserves[token])
            ? minTargetFromCoef
            : (systemBalance + minReserves[token]);

        // Check if current balance exceeds the maximum allowed threshold
        uint256 currentBalance = IERC20(token).balanceOf(address(this));
        uint256 maxAllowed = maxTargetFromCoef;

        if (currentBalance > maxAllowed) {
            // Withdraw excess funds down to the minimum target balance
            uint256 targetBalance = effectiveMinTarget;
            if (currentBalance > targetBalance) {
                uint256 withdrawAmount = currentBalance - targetBalance;
                bool success = IERC20(token).transfer(withdrawAddress, withdrawAmount);
                if (success) {
                    emit AutoWithdrawal(token, withdrawAmount, withdrawAddress);
                }
            }
        }
    }

    /// @notice Deposit ERC20 tokens with signature verification
    /// @param signId The unique identifier for this order
    /// @param token The ERC20 token contract address
    /// @param amount The amount of tokens to deposit
    /// @param deadline The deadline timestamp after which the signature is invalid
    /// @param systemBalance The system balance parameter
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function depositToken(
        uint signId,
        address token,
        uint256 amount,
        uint deadline,
        uint systemBalance,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        if (processedOrders[signId]) {
            revert OrderAlreadyProcessed();
        }

        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }

        bytes32 msgHash = keccak256(
            abi.encode(signId, msg.sender, token, amount, deadline, systemBalance, address(this))
        );
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[signId] = true;

        // Track last deposit amount for refund validation
        deposits[msg.sender][token] = amount;

        IERC20(token).transferFrom(msg.sender, address(this), amount);
        emit TokenDeposited(signId, msg.sender, token, amount);

        // Auto-withdraw excess balance only if this is a newer signId to ensure systemBalance is fresh
        if (signId > lastSignId[token]) {
            lastSignId[token] = signId;
            _autoWithdrawToken(token, systemBalance);
        }
    }

    /// @notice Claim ERC20 tokens for an order with signature verification
    /// @param signId The unique identifier for the order
    /// @param account The account to receive the tokens
    /// @param token The ERC20 token contract address
    /// @param amount The amount of tokens to claim
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function claimToken(
        uint signId,
        address account,
        address token,
        uint256 amount,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        if (processedOrders[signId]) {
            revert OrderAlreadyProcessed();
        }

        bytes32 msgHash = keccak256(
            abi.encode(signId, account, token, amount, address(this))
        );
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[signId] = true;

        // Clear deposit record when claimed (claimed funds are no longer refundable)
        deposits[account][token] = 0;

        IERC20(token).transfer(account, amount);
        emit TokenClaimed(signId, account, token, amount);
    }

    /// @notice Withdraws ERC-20 tokens held by the contract to the caller, leaving a reserved amount
    /// @param _tokenContract The ERC-20 contract address
    /// @param reserved The amount of tokens to leave in the contract
    function withdrawERC20(
        IERC20 _tokenContract,
        uint256 reserved
    ) external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = _tokenContract.balanceOf(address(this));
        if (balance < reserved) {
            revert InsufficientBalance();
        }
        uint256 withdrawAmount = balance - reserved;
        _tokenContract.transfer(msg.sender, withdrawAmount);
        emit TokenWithdrawn(msg.sender, address(_tokenContract), withdrawAmount, reserved);
    }

    /// @notice Refund ERC20 tokens to a specific account (amount must be <= deposit)
    /// @param account The account to receive the refund
    /// @param token The ERC20 token contract address
    /// @param amount The amount of tokens to refund
    function refundToken(
        address account,
        address token,
        uint256 amount
    ) external onlyRole(REFUND_ROLE) {
        if (account == address(0)) {
            revert ZeroAddress();
        }

        // Validate refund amount doesn't exceed deposit amount
        if (deposits[account][token] < amount) {
            revert InvalidRefundAmount();
        }

        // Reset the deposit record
        deposits[account][token] = 0;

        IERC20(token).transfer(account, amount);
        emit TokenRefunded(account, token, amount);
    }

    /// @notice Allows direct token transfers to topup the contract balance
    /// @param token The ERC20 token contract address
    /// @param amount The amount of tokens to transfer to the contract
    /// @dev This is a convenience function for users to directly send tokens to the contract
    ///      The tokens will be added to the contract's balance and can be used for claims
    function topup(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        emit Topup(msg.sender, token, amount);
    }
}
