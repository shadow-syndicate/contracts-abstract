// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../interfaces/IInventory.sol";

contract MockInventory is ERC1155, AccessControl, IInventory {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    constructor() ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(BURNER_ROLE, msg.sender);
    }

    function mint(address account, uint256 id, uint256 amount, bytes memory data) external override {
        _mint(account, id, amount, data);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) external override {
        _mintBatch(to, ids, amounts, data);
    }

    function burnAdmin(address account, uint256 id, uint256 amount, bytes memory) external override onlyRole(BURNER_ROLE) {
        _burn(account, id, amount);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155, AccessControl, IERC165) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
