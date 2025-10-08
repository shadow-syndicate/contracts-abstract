// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../TRAX.sol";

contract TraxDebug is TRAX {

    constructor(address defaultAdmin, address minter, address _signerAddress)
    TRAX(defaultAdmin, minter, _signerAddress)
    {
    }

    function getSigner(uint256 value, uint256 id, address account, uint256 param, uint8 sigV, bytes32 sigR, bytes32 sigS)
        external view returns (address) {
        bytes32 msgHash = keccak256(abi.encode(id, value, account, param, address(this)));
        return ecrecover(msgHash, sigV, sigR, sigS);
    }

    function getHash(uint256 value, uint256 id, address account, uint256 param) external view returns (bytes32) {
        bytes32 msgHash = keccak256(abi.encode(id, value, account, param, address(this)));
        return msgHash;
    }

}
