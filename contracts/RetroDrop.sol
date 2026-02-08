// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
//
// Roach Racing Club makes trading a social and competitive game —
// play with friends, prove your edge, and win while having fun
// https://roach.fun
/*
                                                                   ..::--------::..
                                                               .:--------------------::
                                                            :----------------------------:
                                                         .:---------------------------------.
                                                        :-------------------------------------
                                                      .----------------------------------------:
                                                     :------------------------------------------:
                                                    :--===----------------------------------===--:
                                                   .--+@@@@%%#+=----------------------=+*#%@@@@+--:
                                                   ---@@@@@@@@@@@#+----------------+#@@@@@@@@@@@=--
                                                  :--+@@@@@@@@@@@@@@#+----------=#@@@@@@@@@@@@@@*--:
                                                  ---#@@@@@@@@@@@@@@@@%+------=%@@@@@@@@@@@@@@@@%---
                                                  -----==+*%@@@@@@@@@@@@%=--=#@@@@@@@@@@@@%*++=-----
                                                  -----------=*@@@@@@@@@@@*+@@@@@@@@@@@#+-----------
                                                  :-------------+%@@@@@@@@@@@@@@@@@@%+-------------:
                                                   ---------------*@@@@@@@@@@@@@@@@*---------------
                                                   :---------------=@@@@@@@@@@@@@@+---------------:
                                                    :---------------=@@@@@@@@@@@@=----------------
                                                     :---------------+@@@@@@@@@@*---------------:
                                                      :---------------%@@@@@@@@@---------------:
                                                        --------------#@@@@@@@@%--------------.
                                                         .------------#@@@@@@@@#------------.
                                                            :---------*@@@@@@@@#---------:.
                                                               :----------------------:.
                                                                     ..::--------:::.



███████╗██╗  ██╗ █████╗ ██████╗  ██████╗ ██╗    ██╗    ███████╗██╗   ██╗███╗   ██╗██████╗ ██╗ ██████╗ █████╗ ████████╗███████╗    ██╗███╗   ██╗ ██████╗
██╔════╝██║  ██║██╔══██╗██╔══██╗██╔═══██╗██║    ██║    ██╔════╝╚██╗ ██╔╝████╗  ██║██╔══██╗██║██╔════╝██╔══██╗╚══██╔══╝██╔════╝    ██║████╗  ██║██╔════╝
███████╗███████║███████║██║  ██║██║   ██║██║ █╗ ██║    ███████╗ ╚████╔╝ ██╔██╗ ██║██║  ██║██║██║     ███████║   ██║   █████╗      ██║██╔██╗ ██║██║
╚════██║██╔══██║██╔══██║██║  ██║██║   ██║██║███╗██║    ╚════██║  ╚██╔╝  ██║╚██╗██║██║  ██║██║██║     ██╔══██║   ██║   ██╔══╝      ██║██║╚██╗██║██║
███████║██║  ██║██║  ██║██████╔╝╚██████╔╝╚███╔███╔╝    ███████║   ██║   ██║ ╚████║██████╔╝██║╚██████╗██║  ██║   ██║   ███████╗    ██║██║ ╚████║╚██████╗██╗
╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝  ╚══╝╚══╝     ╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝    ╚═╝╚═╝  ╚═══╝ ╚═════╝╚═╝

*/
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVotingEscrowLock {
    function create_lock_for(uint256 _value, uint256 _lock_duration, address _to) external returns (uint256);
}

/**
 * @title RetroDrop
 * @dev Allows users to claim ROACH tokens based on XPR allocation with optional VotingEscrow locking.
 * The amount received is calculated using: roachMax * sqrt((lockWeeks + 1) / 209)
 * - lockWeeks = 0: tokens transferred directly (no lock)
 * - lockWeeks > 0: tokens locked via VotingEscrow.create_lock_for
 */
contract RetroDrop is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    IERC20 public immutable roachToken;
    IVotingEscrowLock public immutable votingEscrow;

    mapping(uint256 => bool) public usedSignIds;

    uint256 public constant MAX_LOCK_WEEKS = 208;
    uint256 public constant DIVISOR = 209;
    uint256 public constant PRECISION = 1e18;

    event Claimed(
        address indexed account,
        uint256 indexed signId,
        uint256 roachMax,
        uint256 lockWeeks,
        uint256 actualAmount,
        uint256 tokenId
    );

    event Withdrawn(address indexed recipient, uint256 amount);

    error InvalidSignature();
    error DeadlineExpired();
    error SignIdAlreadyUsed();
    error InvalidLockWeeks();
    error InsufficientBalance();
    error ZeroAddress();
    error ZeroValue();

    /**
     * @dev Constructor
     * @param _admin Address to receive DEFAULT_ADMIN_ROLE and WITHDRAW_ROLE
     * @param _signer Address to receive SIGNER_ROLE
     * @param _roachToken ROACH token address
     * @param _votingEscrow VotingEscrow contract address
     */
    constructor(
        address _admin,
        address _signer,
        address _roachToken,
        address _votingEscrow
    ) {
        if (_admin == address(0) || _signer == address(0) || _roachToken == address(0) || _votingEscrow == address(0)) {
            revert ZeroAddress();
        }

        roachToken = IERC20(_roachToken);
        votingEscrow = IVotingEscrowLock(_votingEscrow);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(SIGNER_ROLE, _signer);
        _grantRole(WITHDRAW_ROLE, _admin);

        // Approve VotingEscrow to spend ROACH tokens
        IERC20(_roachToken).approve(_votingEscrow, type(uint256).max);
    }

    /**
     * @dev Claim ROACH tokens with optional VotingEscrow locking
     * @param lockWeeks Number of weeks to lock (0-208). 0 = no lock, direct transfer
     * @param signId Unique signature ID to prevent replay attacks
     * @param roachMax Maximum claimable amount at 208 weeks lock
     * @param deadline Timestamp after which the signature expires
     * @param v ECDSA signature v component
     * @param r ECDSA signature r component
     * @param s ECDSA signature s component
     * @return actualAmount Amount of tokens received
     * @return tokenId VotingEscrow NFT ID (0 if lockWeeks = 0)
     */
    function claim(
        uint256 lockWeeks,
        uint256 signId,
        uint256 roachMax,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 actualAmount, uint256 tokenId) {
        // Validate inputs
        if (lockWeeks > MAX_LOCK_WEEKS) {
            revert InvalidLockWeeks();
        }
        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }
        if (usedSignIds[signId]) {
            revert SignIdAlreadyUsed();
        }

        // Verify signature
        bytes32 message = keccak256(abi.encode(
            signId,
            msg.sender,
            roachMax,
            deadline,
            block.chainid,
            address(this)
        ));

        address signer = ecrecover(message, v, r, s);
        if (!hasRole(SIGNER_ROLE, signer)) {
            revert InvalidSignature();
        }

        // Mark signId as used (CEI pattern)
        usedSignIds[signId] = true;

        // Calculate actual amount based on lock duration
        actualAmount = calculateAmount(roachMax, lockWeeks);

        // Check balance
        if (roachToken.balanceOf(address(this)) < actualAmount) {
            revert InsufficientBalance();
        }

        if (lockWeeks == 0) {
            // Direct transfer without locking
            roachToken.safeTransfer(msg.sender, actualAmount);
            tokenId = 0;
        } else {
            // Create VotingEscrow lock
            uint256 lockDuration = lockWeeks * 1 weeks;
            tokenId = votingEscrow.create_lock_for(actualAmount, lockDuration, msg.sender);
        }

        emit Claimed(msg.sender, signId, roachMax, lockWeeks, actualAmount, tokenId);
    }

    /**
     * @dev Calculate actual token amount based on lock duration
     * Formula: roachMax * sqrt((lockWeeks + 1) / 209)
     * @param roachMax Maximum claimable amount
     * @param lockWeeks Number of weeks to lock
     * @return Actual amount to receive
     */
    function calculateAmount(uint256 roachMax, uint256 lockWeeks) public pure returns (uint256) {
        // actualAmount = roachMax * sqrt((lockWeeks + 1) / DIVISOR)
        // To maintain precision: roachMax * sqrt((lockWeeks + 1) * PRECISION) / sqrt(DIVISOR * PRECISION)

        uint256 numerator = (lockWeeks + 1) * PRECISION;
        uint256 denominator = DIVISOR * PRECISION;

        uint256 sqrtNumerator = _sqrt(numerator);
        uint256 sqrtDenominator = _sqrt(denominator);

        return (roachMax * sqrtNumerator) / sqrtDenominator;
    }

    /**
     * @dev Babylonian method for integer square root
     * @param x Value to compute square root of
     * @return y Square root of x (rounded down)
     */
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        y = x;

        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /**
     * @dev Withdraw ROACH tokens from contract
     * @param recipient Address to receive tokens
     * @param amount Amount to withdraw
     */
    function withdraw(address recipient, uint256 amount) external onlyRole(WITHDRAW_ROLE) {
        if (recipient == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroValue();
        }

        roachToken.safeTransfer(recipient, amount);
        emit Withdrawn(recipient, amount);
    }

    /**
     * @dev Withdraw all ROACH tokens from contract
     */
    function withdrawAll() external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = roachToken.balanceOf(address(this));
        if (balance == 0) {
            revert ZeroValue();
        }

        roachToken.safeTransfer(msg.sender, balance);
        emit Withdrawn(msg.sender, balance);
    }

    /**
     * @dev Get ROACH token balance of this contract
     * @return Balance of ROACH tokens
     */
    function getRoachBalance() external view returns (uint256) {
        return roachToken.balanceOf(address(this));
    }

    /**
     * @dev Check if a signId has been used
     * @param signId Signature ID to check
     * @return True if signId has been used
     */
    function isSignIdUsed(uint256 signId) external view returns (bool) {
        return usedSignIds[signId];
    }

    /**
     * @dev Preview claimable amount for given parameters
     * @param roachMax Maximum claimable amount
     * @param lockWeeks Number of weeks to lock
     * @return Amount that would be received
     */
    function previewClaim(uint256 roachMax, uint256 lockWeeks) external pure returns (uint256) {
        if (lockWeeks > MAX_LOCK_WEEKS) {
            return 0;
        }
        return calculateAmount(roachMax, lockWeeks);
    }
}
