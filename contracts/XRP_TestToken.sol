// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";

contract XRPTestToken is ERC20PresetMinterPauser {
    constructor() ERC20PresetMinterPauser("Test XRP", "XRP") {
        mint(msg.sender, 277_000_000 * uint256(10) ** decimals());
    }
}
