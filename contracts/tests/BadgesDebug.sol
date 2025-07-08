// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.0;

import "../Badges.sol";

contract BadgesDebug is Badges {

    constructor(address defaultAdmin, address _signerAddress, string memory _uri)
        Badges(defaultAdmin, _signerAddress, _uri) {
    }

    /// @dev Internal hook to check for transfer rules and ownership constraints
    /// @param from The sender address
    /// @param to The recipient address
    /// @param ids The token IDs being transferred
    /// @param values The amounts being transferred
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        virtual
        override(Badges)
    {
        ERC1155._update(from, to, ids, values);
    }

    function burn(address account, uint256 id) public virtual {
        if (account != _msgSender() && !isApprovedForAll(account, _msgSender())) {
            revert ERC1155MissingApprovalForAll(_msgSender(), account);
        }

        _burn(account, id, 1);
    }

    function mintPublic(uint256 id)
        external
    {
        _mint(msg.sender, id, 1, "");
    }
}
