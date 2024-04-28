// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "./BaseStaking.sol";

contract SolarStaking is BaseStaking {
    constructor(
        address _TOKEN,
        address payable _wallet,
        uint256 _start,
        uint256 _unlockTime,
        BaseStaking.saleTokenInfo[] memory _saleTokens,
        BaseStaking.bonusMapInfo[] memory _bonusMap,
        BaseStaking.roundInitInfo[] memory _roundInit
    ) BaseStaking(_TOKEN, _wallet, _start, _unlockTime, 6, _saleTokens, _bonusMap, _roundInit) {}
}
