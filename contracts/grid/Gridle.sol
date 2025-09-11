// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.0;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

//┌─────────────────────────────────────────────────────────┐
//│                        +----+----+----+----+            │
//│                        | 4x |BID | 5x | 7x |            │
//│                        +----+----+----+----+            │
//│                      ▁▁▁WIN | 3x | 4x | 5x |            │
//│                      ▏ +----+----+----+----+            │
//│▔▔▔▏     ▏         ▁▁▏  | 2x | 3x |BID | 6x |            │
//│    ▏    ▏▔▔▏     ▏     +----+----+----+----+            │
//│     ▏  ▏   ▔▔▏  ▏      | 3x | 4x | 5x | 7x |            │
//│     ▏▔▔      ▔▔▔       +----+----+----+----+            │
//│                        | 5x | 6x | 8x |10x |            │
//└─────────────────────────────────────────────────────────┘
//0s   5s   10s   15s   20s  25s  30s  35s  40s  45s   → Time

/// @title Gridle game
/// @notice A payment grid contract that handles ETH deposits, claims, and refunds with signature verification
/// @dev Uses cryptographic signatures to authorize deposits and claims. Each order ID can only be processed once to prevent
///      double spending. Supports role-based refunds for ETH.
contract Gridle is AccessControl {
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");
    bytes32 public constant REFUND_ROLE = keccak256("REFUND_ROLE");

    /// @notice Address used to verify deposit signatures
    address public signerAddress;

    /// @notice Address to receive automatic withdrawals when balance exceeds limits
    address public withdrawAddress;

    /// @notice Mapping to track processed order IDs to prevent double spending
    mapping(uint => bool) public processedOrders;

    /// @notice Mapping to track last deposited amount per account for refund validation
    mapping(address => uint256) public deposits;

    /// @notice Minimum balance target as a percentage of systemBalance (in basis points)
    /// @dev Target balance after withdrawal = systemBalance * minReservesCoef / 10000
    /// @dev Example: 11000 = 110% means keep 110% of systemBalance (if systemBalance=100 ETH, keep 110 ETH)
    uint256 public minReservesCoef;

    /// @notice Maximum balance threshold as a percentage of systemBalance (in basis points)
    /// @dev When balance exceeds systemBalance * maxReservesCoef / 10000, auto-withdrawal triggers
    /// @dev Example: 15000 = 150% means trigger withdrawal when balance > 150% of systemBalance
    uint256 public maxReservesCoef;

    /// @notice Absolute minimum ETH buffer to maintain regardless of systemBalance
    /// @dev Used as a safety floor when systemBalance is very low or zero
    /// @dev If (systemBalance + minReserves) > coefficient-based target, this value is used instead
    uint256 public minReserves;

    /// @notice Last processed signId to track order sequence
    uint256 public lastSignId;


    /// @notice Error thrown when a provided signature is invalid
    error WrongSignature();

    /// @notice Error thrown when an order has already been processed
    error OrderAlreadyProcessed();

    /// @notice Error thrown when a zero address is provided where not allowed
    error ZeroAddress();

    /// @notice Error thrown when ETH transfer fails
    error EthTransferFailed();

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


    /// @notice Emitted when a successful ETH deposit is made
    /// @param signId The unique identifier for the order
    /// @param depositor The address that made the deposit
    /// @param amount The amount deposited in wei
    event EthDeposited(uint indexed signId, address indexed depositor, uint256 amount);

    /// @notice Emitted when a successful ETH claim is made
    /// @param signId The unique identifier for the order
    /// @param account The address that claimed the payment
    /// @param amount The amount claimed in wei
    event EthClaimed(uint indexed signId, address indexed account, uint256 amount);

    /// @notice Emitted when ETH is refunded to an account
    /// @param account The address that received the refund
    /// @param amount The amount refunded in wei
    event EthRefunded(address indexed account, uint256 amount);

    /// @notice Emitted when reserve parameters are updated
    /// @param minReservesCoef The new minimum reserves coefficient
    /// @param maxReservesCoef The new maximum reserves coefficient
    /// @param minReserves The new minimum reserves amount
    event ReserveParametersUpdated(uint256 minReservesCoef, uint256 maxReservesCoef, uint256 minReserves);

    /// @notice Emitted when automatic withdrawal occurs
    /// @param token The token address (address(0) for ETH)
    /// @param amount The amount automatically withdrawn
    /// @param recipient The address that received the withdrawal
    event AutoWithdrawal(address indexed token, uint256 amount, address indexed recipient);

    /// @notice Emitted when ETH is withdrawn from the contract
    /// @param withdrawer The address that performed the withdrawal
    /// @param amount The amount withdrawn in wei
    /// @param reserved The amount left reserved in the contract
    event EthWithdrawn(address indexed withdrawer, uint256 amount, uint256 reserved);

    /// @notice Emitted when contract receives ETH directly
    /// @param sender The address that sent ETH to the contract
    /// @param amount The amount sent in wei
    event Topup(address indexed sender, uint256 amount);

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
        minReserves = 1 ether;
    }


    /// @notice Allows an admin to update the authorized signer address
    /// @param newSigner The new signer address
    function setSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        signerAddress = newSigner;
    }

    /// @notice Set reserve parameters including coefficients and absolute minimum reserves
    /// @param _minReservesCoef The minimum reserves coefficient in basis points (10000 = 100%)
    /// @param _maxReservesCoef The maximum reserves coefficient in basis points (10000 = 100%)
    /// @param _minReserves The absolute minimum reserves amount that must always be present
    function setReserveParameters(
        uint256 _minReservesCoef,
        uint256 _maxReservesCoef,
        uint256 _minReserves
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
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
        minReserves = _minReserves;
        emit ReserveParametersUpdated(_minReservesCoef, _maxReservesCoef, _minReserves);
    }

    /// @notice Set the address to receive automatic withdrawals
    /// @param _withdrawAddress The address to receive automatic withdrawals
    function setWithdrawAddress(address _withdrawAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_withdrawAddress == address(0)) {
            revert ZeroAddress();
        }
        withdrawAddress = _withdrawAddress;
    }

    /// @notice Internal function to handle automatic ETH withdrawals when balance exceeds limits
    /// @param systemBalance The required system balance (funds needed for operations)
    function _autoWithdraw(uint256 systemBalance) internal {
        // Calculate the total balance targets using coefficients
        // Example: if systemBalance = 100 ETH and minReservesCoef = 11000 (110%)
        // then minTargetFromCoef = 110 ETH (keeping 110% of what's needed)
        uint256 minTargetFromCoef = (systemBalance * minReservesCoef) / 10000;
        uint256 maxTargetFromCoef = (systemBalance * maxReservesCoef) / 10000;

        // Ensure we keep at least the coefficient-based target OR systemBalance + absolute minimum
        // This provides a safety floor: either percentage-based or fixed minimum buffer
        uint256 effectiveMinTarget = minTargetFromCoef > (systemBalance + minReserves)
            ? minTargetFromCoef
            : (systemBalance + minReserves);

        // Check if current balance exceeds the maximum allowed threshold
        uint256 currentBalance = address(this).balance;
        uint256 maxAllowed = maxTargetFromCoef;

        if (currentBalance > maxAllowed) {
            // Withdraw excess funds down to the minimum target balance
            uint256 targetBalance = effectiveMinTarget;
            if (currentBalance > targetBalance) {
                uint256 withdrawAmount = currentBalance - targetBalance;
                (bool success, ) = payable(withdrawAddress).call{
                    value: withdrawAmount
                }("");
                if (success) {
                    emit AutoWithdrawal(address(0), withdrawAmount, withdrawAddress);
                }
            }
        }
    }

    /// @notice Deposit ether with signature verification. Can also be used for time limited bids.
    /// @param signId The unique identifier for this order
    /// @param deadline The deadline timestamp after which the signature is invalid
    /// @param systemBalance The system balance parameter
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function depositEth(
        uint signId,
        uint deadline,
        uint systemBalance,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external payable {
        if (processedOrders[signId]) {
            revert OrderAlreadyProcessed();
        }

        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }

        bytes32 msgHash = keccak256(
            abi.encode(signId, msg.sender, msg.value, deadline, systemBalance, address(this))
        );
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[signId] = true;

        // Track last deposit amount for refund validation
        deposits[msg.sender] = msg.value;

        emit EthDeposited(signId, msg.sender, msg.value);

        // Auto-withdraw excess ETH balance only if this is a newer signId to be sure that systemBalance is fresh data
        if (signId > lastSignId) {
            lastSignId = signId;
            _autoWithdraw(systemBalance);
        }
    }


    /// @notice Claim payment for an order with signature verification
    /// @param signId The unique identifier for the order
    /// @param account The account to receive the payment
    /// @param value The amount to claim
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function claimEth(
        uint signId,
        address account,
        uint256 value,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        if (processedOrders[signId]) {
            revert OrderAlreadyProcessed();
        }

        bytes32 msgHash = keccak256(
            abi.encode(signId, account, value, address(this))
        );
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[signId] = true;

        // Clear deposit record when claimed (claimed funds are no longer refundable)
        deposits[account] = 0;

        (bool success, ) = payable(account).call{value: value}("");
        if (!success) {
            revert EthTransferFailed();
        }

        emit EthClaimed(signId, account, value);
    }


    /// @notice Withdraws ETH held by the contract to the caller, leaving a reserved amount
    /// @param reserved The amount of ETH to leave in the contract
    function withdrawEth(uint256 reserved) external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = address(this).balance;
        if (balance < reserved) {
            revert InsufficientBalance();
        }
        uint256 withdrawAmount = balance - reserved;
        (bool success, ) = payable(msg.sender).call{
            value: withdrawAmount
        }("");
        if (!success) {
            revert EthTransferFailed();
        }
        emit EthWithdrawn(msg.sender, withdrawAmount, reserved);
    }

    /// @notice Refund ETH to a specific account (amount must be <= deposit)
    /// @param account The account to receive the refund
    /// @param value The amount to refund in wei
    function refundEth(address account, uint256 value) external onlyRole(REFUND_ROLE) {
        if (account == address(0)) {
            revert ZeroAddress();
        }

        // Validate refund amount doesn't exceed deposit amount
        if (deposits[account] < value) {
            revert InvalidRefundAmount();
        }

        // Reset the deposit record
        deposits[account] = 0;

        (bool success, ) = payable(account).call{value: value}("");
        if (!success) {
            revert EthTransferFailed();
        }
        emit EthRefunded(account, value);
    }

    /// @notice Allows contract to receive ETH transfers directly
    receive() external payable {
        emit Topup(msg.sender, msg.value);
    }

}
