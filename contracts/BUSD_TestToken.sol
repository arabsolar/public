// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";

contract BUSDTestToken is ERC20PresetMinterPauser {
    constructor() ERC20PresetMinterPauser("Test BUSD", "BUSD") {
        mint(msg.sender, 100_000_000_000 * uint256(10) ** decimals());
    }
}
