// SPDX-License-Identifier: MIT
// Roach Racing Club: gamified trading competitions, where trading becomes a fun,
// fast-paced game set in the wicked Nanoverse (https://roachracingclub.com)

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

pragma solidity ^0.8.22;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITRAX} from "./interfaces/ITRAX.sol";
import {ITraxExchange} from "./interfaces/ITraxExchange.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title TraxRedeem
/// @notice Allows users to burn TRAX tokens in exchange for USDC at a fixed rate,
///         pulling reserves from both this contract and the TraxExchange as needed.
/// @dev The TRAX→USDC rate (TRAX_PRICE) is read _once_ at deployment
///      and can never be changed. Any subsequent changes in the
///      external price feed will simply freeze further redemptions.
contract TraxRedeem is AccessControl {
    // Role identifier for accounts allowed to withdraw USDC manually
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    /// @notice The TRAX token contract (18 decimals)
    ITRAX public immutable TRAX_TOKEN;
    /// @notice The USDC token contract (6 decimals)
    IERC20 public immutable USDC_TOKEN;
    /// @notice Price of one TRAX in USDC (6 decimals) fetched from TraxExchange
    uint public immutable TRAX_PRICE;
    /// @notice External exchange to withdraw USDC reserves if this contract runs low
    ITraxExchange public immutable TRAX_EXCHANGE;

    event Redeemed(address indexed user, uint256 traxAmount, uint256 usdcAmount);

    // Custom error definitions for gas-efficient failure modes
    error Overflow();            // Arithmetic overflow occurred
    error ZeroAddress();         // Input address was the zero address
    error ZeroPrice();           // TRAX price is zero
    error LowReserves();         // Not enough USDC reserves to fulfill redemption
    error PriceChanged();        // Redeem is frozen because of undesigned price changes
    error ConstraintCheckFailed(); // UseFrom actually have not burned TRAX tokens

    /// @param _traxToken     Address of the TRAX token contract
    /// @param _traxExchange  Address of the external TraxExchange
    /// @param _usdcToken     Address of the USDC token contract
    /// @param defaultAdmin   Address to grant DEFAULT_ADMIN_ROLE
    /// @param withdrawRole   Address to grant WITHDRAW_ROLE
    constructor (
        ITRAX _traxToken,
        ITraxExchange _traxExchange,
        IERC20 _usdcToken,
        address defaultAdmin,
        address withdrawRole
    ) {
        // Prevent setting any of the critical addresses to zero
        if (
            address(_traxToken) == address(0x0) ||
            address(_traxExchange) == address(0x0) ||
            address(_usdcToken) == address(0x0) ||
            defaultAdmin == address(0x0) ||
            withdrawRole == address(0x0)
        ) {
            revert ZeroAddress();
        }

        TRAX_TOKEN    = _traxToken;
        USDC_TOKEN    = _usdcToken;
        TRAX_EXCHANGE = _traxExchange;
        // Fetch the fixed TRAX→USDC price (6 decimals for USDC)
        TRAX_PRICE    = TRAX_EXCHANGE.traxPrices(USDC_TOKEN);
        if (TRAX_PRICE == 0) {
            revert ZeroPrice();
        }
        // Set up access control roles
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(WITHDRAW_ROLE, withdrawRole);
    }

    /// @notice Redeems a specified amount of TRAX for USDC.
    /// @dev Burns TRAX via a signature-based burn function before transferring USDC.
    /// @param value   Amount of TRAX to burn (in 1e18 units)
    /// @param id      Unique identifier for the burn authorization
    /// @param param   Additional parameter consumed by useFrom (e.g., deadline)
    /// @param sigV    ECDSA signature V component
    /// @param sigR    ECDSA signature R component
    /// @param sigS    ECDSA signature S component
    function redeem(
        uint256 value,
        uint256 id,
        uint256 param,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        uint usdcBalanceOnRedeem = USDC_TOKEN.balanceOf(address(this));
        uint usdcBalanceOfExchange = USDC_TOKEN.balanceOf(address(TRAX_EXCHANGE));
        // Check overall contract+exchange reserves before burning
        if (_getAvailableBalance(usdcBalanceOnRedeem, usdcBalanceOfExchange) < 0) {
            // This is uncommon case, when USDC balance is not enough to cover all TRAX supply
            // To protect funds permanently halts redemptions.
            revert LowReserves();
        }
        if (traxPriceWasChanged()) {
            // The redemption rate is irrevocably locked to the deploy-time price.
            // We do not support dynamic repricing. To protect users, any deviation
            // from the original feed value permanently halts redemptions.
            revert PriceChanged();
        }

        address account = msg.sender;

        uint balanceBefore = TRAX_TOKEN.balanceOf(account);

        // Burn TRAX from the user's balance via the authorized signature
        // This only way to burn TRAX using already deployed TRAX contract
        TRAX_TOKEN.useFrom(account, value, id, param, sigV, sigR, sigS);

        uint balanceAfter = TRAX_TOKEN.balanceOf(account);
        if (balanceBefore < balanceAfter) {
            revert ConstraintCheckFailed();
        }

        // Rely only on real burned TRAX amount
        uint burnedTrax = balanceBefore - balanceAfter;
        // Calculate how much USDC is owed for the burned TRAX
        uint usdcValue = getTraxCost(burnedTrax);

        // Attempt to send USDC to the user
        _sendTokens(account, usdcValue, usdcBalanceOnRedeem, usdcBalanceOfExchange);
        emit Redeemed(account, burnedTrax, usdcValue);
    }

    /// @dev Internal function to transfer USDC to user, pulling from exchange if needed.
    /// @param account                Recipient address
    /// @param usdcValue              Amount of USDC to send (in 1e6 units)
    /// @param usdcBalanceOnRedeem    USDC balance of TraxRedeem contract
    /// @param usdcBalanceOfExchange  USDC balance of TraxExchange contract
    function _sendTokens(address account, uint usdcValue, uint usdcBalanceOnRedeem, uint usdcBalanceOfExchange) internal {
        // Compute available balance after any prior burns
        int available = _getAvailableBalance(usdcBalanceOnRedeem, usdcBalanceOfExchange);
        // Ensure positive and sufficient reserves
        if (available <= 0 || uint(available) < usdcValue) {
            revert LowReserves();
        }
        // If this contract’s USDC is insufficient, withdraw from the external exchange
        if (usdcBalanceOnRedeem < usdcValue) {
            _withdrawTraxExchange();
        }
        // Execute transfer to user
        USDC_TOKEN.transfer(account, usdcValue);
    }

    /// @dev Internal call to pull all USDC reserves from the TraxExchange into this contract
    function _withdrawTraxExchange() internal {
        TRAX_EXCHANGE.withdraw(USDC_TOKEN, address(this));
    }

    /// @notice Returns net available USDC across this contract and the exchange,
    ///         minus the amount reserved to back all outstanding TRAX.
    /// @param usdcBalanceOnRedeem    USDC balance of TraxRedeem contract
    /// @param usdcBalanceOfExchange  USDC balance of TraxExchange contract
    /// @return Net USDC available (signed; negative indicates under-collateralized)
    function _getAvailableBalance(uint usdcBalanceOnRedeem, uint usdcBalanceOfExchange) internal view returns (int) {
        return
            SafeCast.toInt256(usdcBalanceOnRedeem)
            + SafeCast.toInt256(usdcBalanceOfExchange)
            - SafeCast.toInt256(getReservedBalance());
    }

    /// @notice Returns net available USDC across this contract and the exchange,
    ///         minus the amount reserved to back all outstanding TRAX.
    /// @return Net USDC available (signed; negative indicates under-collateralized)
    function getAvailableBalance() public view returns (int) {
        return _getAvailableBalance(
            USDC_TOKEN.balanceOf(address(this)),
            USDC_TOKEN.balanceOf(address(TRAX_EXCHANGE)));
    }

    /// @notice Calculates total USDC required to back every TRAX token in circulation.
    /// @return USDC required (in 1e6 units)
    function getReservedBalance() public view returns (uint) {
        uint traxSupply = TRAX_TOKEN.totalSupply();
        return getTraxCost(traxSupply);
    }

    /// @notice Checks if the system is sufficiently collateralized overall.
    /// @return True if reserves cover all circulating TRAX
    function enoughReserves() public view returns (bool) {
        return getAvailableBalance() >= 0;
    }

    /// @notice Checks if the trax prices was changed comparing to deploy time.
    function traxPriceWasChanged() public view returns (bool) {
        return TRAX_PRICE != TRAX_EXCHANGE.traxPrices(USDC_TOKEN);
    }

    /**
     * @notice Converts a given TRAX quantity into USDC amount at the fixed price.
     * @dev Uses safe multiplication/division to prevent overflow.
     * @param traxValue  Amount of TRAX (1e18 units)
     * @return USDC amount equivalent (1e6 units)
     */
    function getTraxCost(uint256 traxValue) public view returns (uint256) {
        // Multiply TRAX amount by USDC price-per-TRAX
        (bool success, uint256 result) = Math.tryMul(traxValue, TRAX_PRICE);
        if (!success) {
            revert Overflow();
        }
        // Adjust for TRAX’s 18 decimals vs USDC’s 6 decimals
        (success, result) = Math.tryDiv(result, 10**18);
        if (!success) {
            revert Overflow();
        }
        return result;
    }

    /// @notice Withdraws all USDC from this contract to the admin.
    /// @dev Only callable by DEFAULT_ADMIN_ROLE.
    function withdrawAll() external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 balance = USDC_TOKEN.balanceOf(address(this));
        USDC_TOKEN.transfer(msg.sender, balance);
    }

    /// @notice Withdraws only the available (excess) USDC from this contract.
    /// @dev Can pull additional USDC from the exchange if needed; only for WITHDRAW_ROLE.
    function withdraw() external onlyRole(WITHDRAW_ROLE) {
        _withdrawTraxExchange();
        int256 balance = getAvailableBalance();
        if (balance < 0) {
            revert LowReserves();
        }
        USDC_TOKEN.transfer(msg.sender, uint(balance));
    }
}
