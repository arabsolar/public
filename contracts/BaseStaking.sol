// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

uint256 constant MAX_INT = 2 ** 256 - 1;
uint256 constant ROUND_DURATION = 15 days;
uint256 constant DEFAULT_STAKING_DURATION = 80 days;
uint256 constant DEFAULT_REF_PCT = 200000;
uint256 constant RATE_STEP = 30000000000000000; //0.03
address constant BNB = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

interface IDexPairV2 {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    function token0() external view returns (address);

    function token1() external view returns (address);
}

abstract contract BaseStaking is Context, Ownable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    struct saleTokenInfo {
        address tokenAddress;
        address mainFeed;
        address crossPoolV3;
        address crossPoolV2;
    }

    struct tokenRecord {
        uint8 index;
        saleTokenInfo saleInfo;
    }

    struct tokenInfo {
        address tokenAddress;
        string name;
        string symbol;
        uint8 decimals;
        bool active;
    }

    struct supportedTokenInfo {
        tokenInfo token;
        uint256 price;
        uint256 balance;
        uint256 allowance;
    }

    struct stakingInfo {
        uint256 amount;
        uint256 startDate;
        uint256 releaseDate;
        uint stakingBasePct;
        uint256 stakingDuration;
    }

    struct roundInitInfo {
        uint256 price;
        uint256 totalCap;
        uint stakingBasePct;
        uint256 stakingDuration;
    }

    struct roundInfo {
        uint256 price;
        uint256 totalCap;//in $
        uint minAmount;
        uint maxAmount;
        bool stopped;
        uint256 totalSold;//in $
        uint index;
        uint stakingBasePct;
        uint256 stakingDuration;
        uint256 ts;
    }

    struct purchaseInfo {
        address purchaser;
        address valueToken;
        uint256 value;
        uint256 amount;
        uint round;
    }

    struct userInfo {
        address referrer;
        uint referrals;
        uint bonusBasePct;
        uint256 totalTokenBonus;
        uint256 totalBonus;
        uint referralBasePct;
    }

    struct bonusMapInfo {
        uint256 value;
        uint basePct;
    }

    // The token being sold
    IERC20 public TOKEN;

    address payable public wallet;
    uint256 public start;
    uint256 public unlockTime;

    mapping(address => tokenRecord) private _supportedTokensRecords;
    tokenInfo[] private _supportedTokens;
    mapping(address => uint256) public totalsByTokens;
    uint256 public totalsTokensSold;
    uint256 public totalsSold;

    bool private _stopped;

    mapping(address => purchaseInfo[]) private _purchases;
    roundInfo[] public rounds;
    mapping(address => stakingInfo[]) private _stakings;
    uint256 private _totalRewardsRequired;
    uint256 private _totalStakingSupply;
    uint256 public totalUsers;

    mapping(address => userInfo) private _users;
    bonusMapInfo[] private _tokenBonusMap;
    event Referral(address indexed addr, address indexed referrer);

    /**
     * event for staking action
     * @param user address of user
     * @param amount amount of staked tokens
     */
    event Staked(address indexed user, uint256 amount, uint round);

    /**
     * event for staking withdraw
     * @param user address of user
     * @param amount amount of tokens to withdraw
     * @param reward amount of tokens for reward
     * @param round round index
     */
    event Withdrawn(address indexed user, uint256 amount, uint256 reward, uint round);

    /**
     * event for token purchase logging
     * @param purchaser who paid & got for the tokens
     * @param valueToken address of token for value amount
     * @param value amount paid for purchase
     * @param amount amount of tokens purchased
     * @param round index of round
     */
    event TokenPurchase(
        address indexed purchaser,
        address indexed valueToken,
        uint256 value,
        uint256 amount,
        uint round
    );

    /**
     * event for token Emergency withdrawal
     * @param receiver address of token receiver
     * @param token address of token
     * @param amount amount of tokens purchased
     */
    event EmergencyWithdrawal(address indexed receiver, address indexed token, uint256 amount);

    constructor(
        address _TOKEN,
        address payable _wallet,
        uint256 _start,
        uint256 _unlockTime,
        uint _startAPY,
        saleTokenInfo[] memory _saleTokens,
        bonusMapInfo[] memory _bonusMap,
        roundInitInfo[] memory _roundInit
    ) {
        require(address(_TOKEN) != address(0));
        require(address(_wallet) != address(0));
        require(_start > 0);
        require(_unlockTime == 0 || (_unlockTime > _start && _unlockTime > block.timestamp));
        require(_bonusMap.length > 0);

        TOKEN = IERC20(_TOKEN);

        wallet = _wallet;
        start = _start;
        unlockTime = _unlockTime;
        for (uint i; i < _bonusMap.length; i++) {
            require(_bonusMap[i].value > 0 && _bonusMap[i].basePct > 0);
            if ((i + 1) < _bonusMap.length) {
                require(_bonusMap[i].value < _bonusMap[i + 1].value);
            }
            _tokenBonusMap.push(_bonusMap[i]);
        }

        _supportedTokens.push(
            tokenInfo(
                _TOKEN,
                IERC20Metadata(_TOKEN).name(),
                IERC20Metadata(_TOKEN).symbol(),
                IERC20Metadata(_TOKEN).decimals(),
                false
            )
        );

        for (uint256 index = 0; index < _saleTokens.length; index++) {
            saleTokenInfo memory info = _saleTokens[index];
            require(info.mainFeed != address(0), "c1");
            require(
                (info.crossPoolV3 != address(0) && info.crossPoolV2 == address(0)) ||
                    ((info.crossPoolV2 != address(0) && info.crossPoolV3 == address(0)) ||
                        (info.crossPoolV2 == address(0) && info.crossPoolV3 == address(0))),
                "c2"
            );

            if (info.crossPoolV2 != address(0)) {
                IDexPairV2 pair = IDexPairV2(info.crossPoolV2);
                require(pair.token0() == info.tokenAddress, "c3");
            }
            _supportedTokensRecords[info.tokenAddress] = tokenRecord(uint8(_supportedTokens.length), info);
            if (info.tokenAddress == BNB) {
                _supportedTokens.push(tokenInfo(info.tokenAddress, "BNB", "BNB", 18, true));
            } else {
                _supportedTokens.push(
                    tokenInfo(
                        info.tokenAddress,
                        IERC20Metadata(info.tokenAddress).name(),
                        IERC20Metadata(info.tokenAddress).symbol(),
                        IERC20Metadata(info.tokenAddress).decimals(),
                        true
                    )
                );
            }
        }
        //init rounds
        for (uint i = 0; i < _roundInit.length; i++) {
            require(_roundInit[i].price > 0 && _roundInit[i].totalCap > 0);
            rounds.push(
                roundInfo(
                    _roundInit[i].price,
                    _roundInit[i].totalCap,
                    50,
                    250010,
                    false,
                    0,
                    rounds.length,
                    _roundInit[i].stakingBasePct > 0 ? _roundInit[i].stakingBasePct : _startAPY,
                    _roundInit[i].stakingDuration > 0
                        ? _roundInit[i].stakingDuration
                        : (_unlockTime > 0 ? _unlockTime - block.timestamp : DEFAULT_STAKING_DURATION),
                    0
                )
            );
        }
    }

    receive() external payable {
        revert("e911");
    }

    function update_round_info(
        uint index,
        uint256 price,
        uint256 totalCap,
        uint minAmount,
        uint maxAmount,
        bool stopped,
        uint256 totalSold,
        uint stakingPct,
        uint256 stakingDuration,
        uint256 ts
    ) external onlyOwner {
        if (index == rounds.length) {//add new round
            rounds.push(
                roundInfo(
                    price,
                    totalCap,
                    minAmount,
                    maxAmount,
                    stopped,
                    totalSold,
                    rounds.length,
                    stakingPct,
                    stakingDuration,
                    ts
                )
            );
            return;
        }
        rounds[index].price = price;
        rounds[index].totalCap = totalCap;
        rounds[index].minAmount = minAmount;
        rounds[index].maxAmount = maxAmount;
        rounds[index].stopped = stopped;
        rounds[index].totalSold = totalSold;
        rounds[index].stakingBasePct = stakingPct;
        rounds[index].stakingDuration = stakingDuration;
        rounds[index].ts = ts;
    }

    function getUserInfo(address sender) external view returns (userInfo memory retval) {
        retval.bonusBasePct = _users[sender].bonusBasePct;
        retval.referralBasePct = _users[_users[sender].referrer].referralBasePct;
        retval.referrals = _users[sender].referrals;
        retval.referrer = _users[sender].referrer;
        retval.totalBonus = _users[sender].totalBonus;
        retval.totalTokenBonus = _users[sender].totalTokenBonus;
    }

    function getCurrentRound() external view returns (roundInfo memory) {
        if (block.timestamp < start) {
            return rounds[0];
        }
        uint256 cur_idx = (block.timestamp - start) / ROUND_DURATION;
        uint256 idx = cur_idx;
        for (; idx < rounds.length; idx++) {
            if (rounds[idx].price > 0 && !rounds[idx].stopped && rounds[idx].totalSold < rounds[idx].totalCap) {
                break;
            }
        }
        if (idx >= rounds.length) {
            idx = rounds.length - 1;
            return roundInfo(
                        cur_idx*RATE_STEP,
                        rounds[idx].totalCap,
                        50,
                        250010,
                        false,
                        0,
                        cur_idx,
                        rounds[idx].stakingBasePct,
                        (unlockTime > 0 ? unlockTime - block.timestamp : DEFAULT_STAKING_DURATION),
                        start + cur_idx*ROUND_DURATION
                    );
        }
        return rounds[idx];
    }

    function getCurrentRate() external view returns (uint256) {
        return this.getCurrentRound().price;
    }

    function scalePrice(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        return (((amount * 1e8) / 10 ** decimals) * 1e10);
    }

    function getTokenPrice(address tokenAddress) external view returns (uint256) {
        if (tokenAddress == address(TOKEN)) {
            return this.getCurrentRate();
        }

        require(_supportedTokensRecords[tokenAddress].saleInfo.mainFeed != address(0), "g1");

        require(_supportedTokens[_supportedTokensRecords[tokenAddress].index].active, "g2");
        saleTokenInfo memory info = _supportedTokensRecords[tokenAddress].saleInfo;
        AggregatorV3Interface dataFeed = AggregatorV3Interface(info.mainFeed);
        (, int256 answer, , , ) = dataFeed.latestRoundData();

        uint256 mainFeedPrice = scalePrice(uint256(answer), dataFeed.decimals());

        if (info.crossPoolV2 == address(0) && info.crossPoolV3 == address(0)) {
            return mainFeedPrice;
        }
        if (info.crossPoolV2 != address(0)) {
            IDexPairV2 pair = IDexPairV2(info.crossPoolV2);
            IERC20Metadata meta = IERC20Metadata(pair.token1());
            (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
            uint256 price = (reserve1 * 10 ** meta.decimals()) / reserve0;
            uint256 priceV2 = (scalePrice(price, meta.decimals()) * mainFeedPrice) / 1e18;
            return priceV2;
        }
        IUniswapV3Pool pool = IUniswapV3Pool(info.crossPoolV3);
        (int24 tick, ) = OracleLibrary.consult(info.crossPoolV3, 5);
        //
        uint128 amountIn = uint128(10 ** IERC20Metadata(pool.token0()).decimals());
        address tokenIn = pool.token0();
        address tokenOut = pool.token1();

        uint256 amountOut = OracleLibrary.getQuoteAtTick(tick, amountIn, tokenIn, tokenOut);
        amountOut = scalePrice(amountOut, IERC20Metadata(pool.token1()).decimals());
        uint256 priceV3 = (amountOut * mainFeedPrice) / 1e18;
        return priceV3;
    }

    function getAppTokenInfo(address user) external view returns (supportedTokenInfo memory info) {
        require(_supportedTokens[0].tokenAddress == address(TOKEN), "g4");
        info.token = _supportedTokens[0];
        info.price = this.getTokenPrice(info.token.tokenAddress);
        info.balance = IERC20(info.token.tokenAddress).balanceOf(user);
        info.allowance = IERC20(info.token.tokenAddress).allowance(user, address(this));
    }

    //@note getSupportedTokensInfo
    function getSupportedTokensInfo(address user) external view returns (supportedTokenInfo[] memory retval) {
        uint count;
        for (uint i; i < _supportedTokens.length; i++) {
            if (!_supportedTokens[i].active) {
                continue;
            }
            count++;
        }
        retval = new supportedTokenInfo[](count);
        uint idx;
        for (uint i; i < _supportedTokens.length; i++) {
            if (!_supportedTokens[i].active) {
                continue;
            }
            supportedTokenInfo memory info;
            info.token = _supportedTokens[i];
            info.price = this.getTokenPrice(info.token.tokenAddress);
            if (info.token.tokenAddress == BNB) {
                info.balance = address(user).balance;
                info.allowance = MAX_INT;
            } else {
                info.balance = IERC20(info.token.tokenAddress).balanceOf(user);
                info.allowance = IERC20(info.token.tokenAddress).allowance(user, address(this));
            }
            retval[idx++] = info;
        }
        return retval;
    }

    function availableBalance() external view returns (uint256 balance) {
        balance = TOKEN.balanceOf(address(this));
    }

    function getUserTotalPaid(address user) external view returns (uint256 balance) {
        for (uint256 i; i < _purchases[user].length; i++) {
            tokenInfo memory token_meta = _supportedTokens[
                _supportedTokensRecords[_purchases[user][i].valueToken].index
            ];
            balance +=
                (scalePrice(_purchases[user][i].value, token_meta.decimals) *
                    this.getTokenPrice(_purchases[user][i].valueToken)) /
                1e18; // convert to price amount
        }
    }

    function getUserTotalSold(address user) external view returns (uint256 balance) {
        for (uint256 i; i < _purchases[user].length; i++) {
            balance += _purchases[user][i].amount;
        }
    }

    function totalRewardsRequired() external view returns (uint256) {
        return _totalRewardsRequired;
    }

    function amountToContractRequired() external view returns (uint256) {
        uint256 balance = TOKEN.balanceOf(address(this));
        return
            (_totalRewardsRequired > 0 && _totalRewardsRequired > (balance - _totalStakingSupply))
                ? _totalRewardsRequired - (balance - _totalStakingSupply)
                : 0;
    }

    function balanceOf(address account) external view returns (uint256 balance) {
        for (uint i; i < _stakings[account].length; i++) {
            balance += _stakings[account][i].amount;
        }
    }

    function canWithdraw(address account) external view returns (bool) {
        uint256 withdrawBalance;
        for (uint i; i < _stakings[account].length; i++) {
            if (block.timestamp > (unlockTime > 0 ? unlockTime : _stakings[account][i].releaseDate)) {
                withdrawBalance += _stakings[account][i].amount;
            }
        }
        return withdrawBalance > 0;
    }

    function canStake() external view returns (bool) {
        return block.timestamp > start && (unlockTime == 0 || block.timestamp < unlockTime) && !_stopped;
    }

    function endStakingTime(address account) external view returns (uint256) {
        return unlockTime > 0 ? unlockTime : _stakings[account][_stakings[account].length - 1].releaseDate;
    }

    function currentReward(address account) external view returns (uint256) {
        uint256 totalRewards;
        for (uint i; i < _stakings[account].length; i++) {
            uint256 amount = _stakings[account][i].amount;
            uint basePct = _stakings[account][i].stakingBasePct;
            bool finished = block.timestamp > (unlockTime > 0 ? unlockTime : _stakings[account][i].releaseDate);
            uint duration = block.timestamp - _stakings[account][i].startDate;
            if (finished) {
                duration =
                    (unlockTime > 0 ? unlockTime : _stakings[account][i].releaseDate) -
                    _stakings[account][i].startDate;
            }
            uint256 individualAPY = basePct * 1e18;
            totalRewards += (((amount * individualAPY) / (365 days)) * duration) / (100 * 1e18);
        }

        return totalRewards;
    }

    function _validatePurchase(
        uint256 _value,
        address _token,
        address sender
    ) internal view returns (uint256, uint256, uint8) {
        require(block.timestamp > start && (unlockTime == 0 || block.timestamp < unlockTime), "e1");
        require(_supportedTokensRecords[_token].saleInfo.mainFeed != address(0), "e2");
        require(_supportedTokens[_supportedTokensRecords[_token].index].active, "e3");
        require(_token == BNB || IERC20(_token).allowance(sender, address(this)) >= _value, "e4");

        tokenInfo memory token_meta = _supportedTokens[_supportedTokensRecords[_token].index];
        roundInfo memory round = this.getCurrentRound();
        require(round.totalCap > 0, "e5");

        _value = (scalePrice(_value, token_meta.decimals) * this.getTokenPrice(_token)) / 1e18; // convert to price amount
        require(_value > 0, "e6");
        require(_value >= round.minAmount * 1e18, "e7");
        require(_value <= round.maxAmount * 1e18, "e7.1");

        uint256 dec = uint256(10) ** uint256(_supportedTokens[0].decimals);

        uint256 amount = (((_value * dec ** 2) / 1e18) / round.price);

        require(this.availableBalance() >= amount, "e8");

        return (amount, _value, token_meta.decimals);
    }

    function _getTokenBonusBasePct(uint256 _value) internal view returns (uint) {
        for (uint i = _tokenBonusMap.length; i > 0; i--) {
            if (_value >= _tokenBonusMap[i - 1].value) {
                return _tokenBonusMap[i - 1].basePct;
            }
        }
        return 0;
    }

    function _buy(uint256 _value, address _token, address sender) internal returns (uint256, uint256) {
        (uint256 amount, uint256 $v, uint8 t_dec) = _validatePurchase(_value, _token, sender);
        uint curTokenBonusPct = _getTokenBonusBasePct($v);
        if (_users[sender].bonusBasePct < curTokenBonusPct) {
            _users[sender].bonusBasePct = curTokenBonusPct;
        }

        totalsByTokens[_token] = totalsByTokens[_token] + _value;
        uint index = this.getCurrentRound().index;
        if (index >= rounds.length) {
            //add new rounds if required
            for (uint idx = rounds.length; idx < (index + 1); idx++) {
                rounds.push(
                    roundInfo(
                        rounds[idx-1].price + RATE_STEP,
                        rounds[idx-1].totalCap,
                        50,
                        250010,
                        idx < index,
                        0,
                        rounds.length,
                        rounds[idx-1].stakingBasePct,
                        (unlockTime > 0 ? unlockTime - block.timestamp : DEFAULT_STAKING_DURATION),
                        rounds[idx-1].ts > 0? rounds[idx-1].ts + ROUND_DURATION : start + idx * ROUND_DURATION
                    )
                );
            }       
        }

        if (_token != BNB) {
            IERC20(_token).safeTransferFrom(sender, address(this), _value);
        }
        uint256 bonus = 0;
        if (curTokenBonusPct > 0) {
            bonus = (amount * curTokenBonusPct) / 1e6;
            _users[sender].totalTokenBonus = _users[sender].totalTokenBonus + bonus;
        }

        address payable referrer = payable(_users[sender].referrer);
        uint refPct = _users[referrer].referralBasePct;
        if (refPct > 0 && referrer != owner() && this.getUserTotalPaid(referrer) >= rounds[index].minAmount) {
            uint256 _v = (_value * refPct) / 1e6;
            if (_token == BNB) {
                referrer.sendValue(_v);
            } else {
                IERC20(_token).safeTransfer(referrer, _v);
            }
            _v = (scalePrice(_v, t_dec) * this.getTokenPrice(_token)) / 1e18; // convert to price amount
            _users[referrer].totalBonus = _users[referrer].totalBonus + _v;
        }
        if (_token == BNB) {
            wallet.sendValue(address(this).balance);
        } else {
            IERC20(_token).safeTransfer(wallet, IERC20(_token).balanceOf(address(this)));
        }

        rounds[index].totalSold = rounds[index].totalSold + $v;
        totalsTokensSold = totalsTokensSold + amount;
        totalsSold = totalsSold + $v;
        if(rounds[index].totalSold >= rounds[index].totalCap) {
            rounds[index].stopped = true;
            if ((index + 1) == rounds.length) {//add new round
                rounds.push(
                    roundInfo(
                        rounds[index].price + RATE_STEP,
                        rounds[index].totalCap,
                        50,
                        250010,
                        false,
                        0,
                        rounds.length,
                        rounds[index].stakingBasePct,
                        (unlockTime > 0 ? unlockTime - block.timestamp : DEFAULT_STAKING_DURATION),
                        block.timestamp
                    )
                );
            } else {
                rounds[index + 1].ts = block.timestamp;
            }
        }
        return (amount + bonus, $v);
    }

    function _round_purchase(uint256 _value, address _token, address sender, uint256 amount, bool doTransfer) internal {
        roundInfo memory round = this.getCurrentRound();
        _purchases[sender].push(purchaseInfo(sender, _token, _value, amount, round.index));
        if (doTransfer) {
            TOKEN.safeTransfer(sender, amount);
        }
        emit TokenPurchase(sender, _token, _value, amount, round.index);
    }

    function _getRewardsAmount(uint256 amount, uint basePct, uint256 duration) private pure returns (uint256) {
        uint256 individualAPY = basePct * 1e18;
        return (((amount * individualAPY) / (365 days)) * duration) / (100 * 1e18);
    }

    function _setReferrer(address _addr, address _referrer) private {
        if (
            _referrer != address(0) &&
            _users[_addr].referrer == address(0) &&
            _referrer != _addr &&
            _addr != owner() &&
            (_purchases[_referrer].length > 0 || _referrer == owner())
        ) {
            _users[_addr].referrer = _referrer;
            _users[_referrer].referrals++;
            _users[_referrer].referralBasePct = DEFAULT_REF_PCT;

            emit Referral(_addr, _referrer);

            totalUsers++;
        }
    }

    function buyAndStake(uint256 _value, address _token, address referrer) external payable {
        address sender = _msgSender();
        require(_stopped == false, "b1");
        require(block.timestamp > start, "b2");
        require(_token == BNB || _value > 0, "b3");
        require(_token != BNB || (_value == 0 && msg.value > 0), "b4");
        require(_supportedTokens[0].tokenAddress == address(TOKEN), "e10");
        _setReferrer(sender, referrer);
        uint256 token_amount = _value;
        if (_token != address(TOKEN)) {
            (token_amount, ) = _buy(_token == BNB ? msg.value : _value, _token, sender);
            _round_purchase(_token == BNB ? msg.value : _value, _token, sender, token_amount, false);
        } else {
            require(_supportedTokens[0].active, "e11");
            TOKEN.safeTransferFrom(sender, address(this), token_amount);
        }

        roundInfo memory round = this.getCurrentRound();
        _stakings[sender].push(
            stakingInfo(
                token_amount,
                block.timestamp,
                unlockTime > 0 ? unlockTime : block.timestamp + round.stakingDuration,
                round.stakingBasePct,
                unlockTime > 0 ? unlockTime - block.timestamp : round.stakingDuration
            )
        );
        _totalStakingSupply = _totalStakingSupply + token_amount;
        _totalRewardsRequired =
            _totalRewardsRequired +
            _getRewardsAmount(
                token_amount,
                round.stakingBasePct,
                unlockTime > 0 ? unlockTime - block.timestamp : round.stakingDuration
            );
        emit Staked(sender, token_amount, round.index);
    }

    function withdraw() public {
        require(_stakings[msg.sender].length > 0, "e12");
        uint256 withdrawAmount;
        uint256 withdrawReward;
        roundInfo memory round = this.getCurrentRound();
        address sender = _msgSender();
        for (uint i; i < _stakings[sender].length; i++) {
            if (block.timestamp > (unlockTime > 0 ? unlockTime : _stakings[sender][i].releaseDate)) {
                uint256 amount = _stakings[sender][i].amount;
                uint256 individualAPYReward = _getRewardsAmount(
                    amount,
                    _stakings[sender][i].stakingBasePct,
                    unlockTime > 0 ? unlockTime - _stakings[sender][i].startDate : _stakings[sender][i].stakingDuration
                );
                withdrawAmount += amount;
                withdrawReward += individualAPYReward;
                delete _stakings[sender][i];
            }
        }
        require(withdrawAmount > 0, "e13");

        _totalStakingSupply = _totalStakingSupply - withdrawAmount;
        _totalRewardsRequired = _totalRewardsRequired - withdrawReward;

        TOKEN.safeTransfer(sender, withdrawAmount + withdrawReward);
        emit Withdrawn(msg.sender, withdrawAmount, withdrawReward, round.index);
    }

    function updateStart(uint256 _start) external onlyOwner {
        require(_start > 0);
        start = _start;
    }

    function updateUnlockTime(uint256 _unlockTime) external onlyOwner {
        require(_unlockTime > block.timestamp);
        unlockTime = _unlockTime;
    }

    function setActiveToken(address _token, bool active) external onlyOwner {
        uint idx;
        if (_token == address(TOKEN)) {
            idx = 0;
        } else {
            require(_supportedTokensRecords[_token].saleInfo.mainFeed != address(0), "d1");
            idx = _supportedTokensRecords[_token].index;
        }
        _supportedTokens[idx].active = active;
    }

    function update_stop(bool stopped) external onlyOwner {
        _stopped = stopped;
    }

    function update_round_stop(uint index, bool stopped) external onlyOwner {
        require(index < rounds.length, "sr1");
        rounds[index].stopped = stopped;
        if (index + 1 < rounds.length) {
            rounds[index + 1].ts = stopped ? block.timestamp : 0;
        }
    }

    function emergencyWithdraw(address _token) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        address recv = owner();
        IERC20(_token).safeTransfer(recv, balance);
        emit EmergencyWithdrawal(recv, _token, balance);
    }
}
