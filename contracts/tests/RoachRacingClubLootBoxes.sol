// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.18;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract RoachRacingClubLootBoxes is ERC721 {
    uint256 private _nextTokenId;

    constructor()
        ERC721("Roach Racing Club: Loot Boxes Test", "ROACHBOX")
    {}

    function _baseURI() internal pure override returns (string memory) {
        return "ipfs://bafybeiaic7qlbsywigv5nfirmtgmt7oo3zt3nmijudan4huqdgcv2vcocu/";
    }

    function mint() public returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        return tokenId;
    }
}
