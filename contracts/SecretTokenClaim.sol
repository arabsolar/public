// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SecretTokenClaim {
    struct Deposit {
        address token;
        address owner;
        uint256 amount;
    }
    address private owner;
    mapping(bytes32 => Deposit) private deposits;
    
    event TokensClaimed(address indexed claimer, address indexed token, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only contract owner can perform this action");
        _;
    }

    function deposit(address _tokenContract, bytes32 _secretHash, uint256 _amount, address _depositOwner) external onlyOwner {
        IERC20 token = IERC20(_tokenContract);
        require(token.balanceOf(address(this)) >= _amount, "Insufficient contract balance");
        //require(deposits[_secretHash].amount == 0, "Deposit already exists!");
        address depositOwner = _depositOwner == address(0)? msg.sender:_depositOwner;
        deposits[_secretHash] = Deposit(_tokenContract, depositOwner, _amount);
    }

    function deleteDeposit(bytes32 _secretHash) external {
        require(deposits[_secretHash].owner == msg.sender || msg.sender == owner, "You are not the owner of this deposit");
        delete deposits[_secretHash];
    }


    function withdraw(bytes32 _secretHash) external {
        require(deposits[_secretHash].owner == msg.sender, "You are not the owner of this deposit");
        IERC20 token = IERC20(deposits[_secretHash].token);
        require(token.transfer(owner, deposits[_secretHash].amount), "Token transfer failed");
    }
    
    function hash(string memory _secret) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(_secret));
    }

    function claim(string memory _secret) external {
        bytes32 secretHash = this.hash(_secret);
        uint256 amount = deposits[secretHash].amount;
        require(amount > 0, "No tokens to claim");
        address token = deposits[secretHash].token;
        require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient contract balance");

        delete deposits[secretHash];
        require(IERC20(token).transfer(msg.sender, amount), "Token transfer failed");

        emit TokensClaimed(msg.sender, token, amount);
    }

    function balanceOf(bytes32 _secretHash) external view returns (uint256) {
        return deposits[_secretHash].amount;
    }
}
