import "../TRAX.sol";

contract TraxTest is TRAX {

    constructor(address defaultAdmin, address minter, address _signerAddress)
        TRAX(defaultAdmin, minter, _signerAddress)
    {
    }

    // Do not check signature and signId unique
    function _use(uint256 value, uint256 id, address account, uint256 param, uint8 sigV, bytes32 sigR, bytes32 sigS) override internal {
        emit Used(id, value, account, param);
    }
}
