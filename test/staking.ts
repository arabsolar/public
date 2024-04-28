import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import { expect } from "chai";
import { config as dotenvConfig } from "dotenv";
import {
  Signer,
  formatUnits,
  parseUnits
} from "ethers";
import { ethers, network } from "hardhat";
import { resolve } from "path";

import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  IERC20,
  IERC20Metadata__factory,
  IERC20__factory,
} from "../typechain-types";

dotenvConfig({ path: resolve(__dirname, ".env") });

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const BNB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
//note: for BSC network
// const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
// const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
// const DAI_ADDRESS = "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3";
// const XRP_ADDRESS = "0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe";

//note: for ETHEREUM network
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
//const XRP_ADDRESS = "0x39fBBABf11738317a448031930706cd3e612e1B9";
const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";


const topupTokenFromNetwork = async (
  token: string,
  amount: number,
  receiver: Signer
): Promise<bigint> => {
  const takerAddress = "0xFBb1b73C4f0BDa4f67dcA266ce6Ef42f520fBB98"; // Bitrex (An account with sufficient balance on mainnet)
  // Impersonate the taker account so that we can submit the quote transaction
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [takerAddress],
  });

  // Get a signer for the account we are impersonating
  const signer = await ethers.getSigner(takerAddress);

  const receiverAddress = await receiver.getAddress();
  const token_factory = IERC20__factory.connect(token, signer);
  const token_meta = IERC20Metadata__factory.connect(token, signer);
  const tx = await token_factory.transfer(
    receiverAddress,
    BigInt(parseUnits(amount.toString(), await token_meta.decimals()))
  );
  await tx.wait();
  //const token_factory = IERC20__factory.connect(token, receiver);
  const balance = await token_factory.balanceOf(receiverAddress);

  return balance;
};

describe("Token Staking", function () {
  let usdc_token: IERC20;
  let usdt_token: IERC20;
  let dai_token: IERC20;
  let wbtc_token: IERC20;
  let app_token: IERC20;

  before(async () => {
    const [owner] = await ethers.getSigners();
    usdc_token = IERC20__factory.connect(USDC_ADDRESS, owner);
    usdt_token = IERC20__factory.connect(USDT_ADDRESS, owner);
    dai_token = IERC20__factory.connect(DAI_ADDRESS, owner);
    wbtc_token = IERC20__factory.connect(WBTC_ADDRESS, owner);
    const appTokenFactory = await ethers.getContractFactory("SolarToken");
    const deployed_app_token = await appTokenFactory.deploy();
    const app_token_address = await deployed_app_token.getAddress();
    app_token = IERC20__factory.connect(app_token_address, owner);
    const coin = await owner.provider.getBalance(owner.address);
    //console.info(`    ${owner.address} COIN balance: ${formatEther(coin)}`);
  });

  async function deployStaking() {
    const [owner, wallet] = await ethers.getSigners();
    // Contracts are deployed using the first signer/account by default
    const stakingFactory = await ethers.getContractFactory("SolarStaking");
    const startTime = Math.floor(Date.now() / 1000) - 600;

    const staking = await stakingFactory.deploy(
      app_token,
      wallet.address,
      startTime,
      0,
      [
        {
          tokenAddress: USDT_ADDRESS,
          mainFeed: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D", //USDT_USD
          crossPoolV2: ZERO_ADDRESS,
          crossPoolV3: ZERO_ADDRESS,
        },
        {
          tokenAddress: USDC_ADDRESS,
          mainFeed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", //USDC_USD
          crossPoolV2: ZERO_ADDRESS,
          crossPoolV3: ZERO_ADDRESS,
        },
        {
          tokenAddress: DAI_ADDRESS,
          mainFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", //ETH_USD
          crossPoolV2: ZERO_ADDRESS,
          //crossPoolV2: "0xa478c2975ab1ea89e8196811f51a7b7ade33eb11", //DAI_ETH V2
          //crossPoolV3: ZERO_ADDRESS
          crossPoolV3: "0x60594a405d53811d3bc4766596efd80fd545a270", //DAI_ETH
        },
        {
          tokenAddress: BNB,
          mainFeed: "0x14e613AC84a31f709eadbdF89C6CC390fDc9540A", //BNB_USD
          crossPoolV2: ZERO_ADDRESS,
          crossPoolV3: ZERO_ADDRESS
        },
      ],
      [
        {
          value: parseUnits("250", 18),
          basePct: 50000
        },
        {
          value: parseUnits("500", 18),
          basePct: 70000
        },
        {
          value: parseUnits("1000", 18),
          basePct: 100000
        },
        {
          value: parseUnits("2500", 18),
          basePct: 120000
        },
        {
          value: parseUnits("5000", 18),
          basePct: 150000
        },
        {
          value: parseUnits("10000", 18),
          basePct: 200000
        },
        {
          value: parseUnits("25000", 18),
          basePct: 300000
        }
      ],
      [
        {
          price: parseUnits("0.01", 18),
          totalCap: parseUnits("300000", 18),//300k$
          stakingBasePct: 0,
          stakingDuration: 0
        },
        {
          price: parseUnits("0.03", 18),
          totalCap: parseUnits("300000", 18),//300k$
          stakingBasePct: 0,
          stakingDuration: 0
        },
      ],
    );

    const meta = IERC20Metadata__factory.connect(
      await app_token.getAddress(),
      owner
    );
    var decimals = await meta.decimals();
    await app_token.transfer(
      await staking.getAddress(),
      parseUnits("100000000", decimals)
    );
    return { staking };
  }

  describe("Deployment", function () {
    it("Should be success deployment", async function () {
      expect(loadFixture(deployStaking)).not.to.be.reverted;
    });
  });

  describe("Staking", function () {
    it("Should be success receiving supported tokens info", async function () {
      const { staking } = await loadFixture(deployStaking);
      const [owner] = await ethers.getSigners();
      const tokens = await staking.getSupportedTokensInfo(owner.address);
      expect(tokens.length).to.equal(4);
      //expect(tokens[0].token.tokenAddress).eq(await app_token.getAddress());
      expect(tokens[0].token.tokenAddress).eq(await usdt_token.getAddress());
      expect(tokens[1].token.tokenAddress).eq(await usdc_token.getAddress());
      expect(tokens[2].token.tokenAddress).eq(await dai_token.getAddress());
      expect(tokens[3].token.tokenAddress).eq(BNB);
    });

    it("Should be success buy and stake with BNB", async function () {
      const { staking } = await loadFixture(deployStaking);
      const zero = parseUnits("0", 18);
      const [owner, wallet] = await ethers.getSigners();
      const balance = await owner.provider.getBalance(owner.address);
      const walletBalance = await wallet.provider.getBalance(wallet.address);
      const contractAddress = await staking.getAddress();
      const stakingBalance = await owner.provider.getBalance(contractAddress);
      expect(balance).to.not.equal(zero);
      // console.info(`    ${owner.address} owner BNB balance: ${formatEther(balance)}`);
      // console.info(`    ${wallet.address} wallet BNB balance: ${formatEther(walletBalance)}`);
      // console.info(`    ${contractAddress} contract BNB balance: ${formatEther(stakingBalance)}`);
      const amount = parseUnits("1", 18);

      const tokens = await staking.getSupportedTokensInfo(owner.address);
      expect(tokens[3].balance).to.be.equal(balance);
      //console.log(tokens[3]);
      await expect(staking.buyAndStake(0, BNB, ZERO_ADDRESS, { value: amount })).not.to.be
        .reverted;
      const stakingBalanceAfter = await owner.provider.getBalance(contractAddress);
      const balanceAfter = await wallet.provider.getBalance(owner.address);
      expect(balanceAfter).to.be.lessThan(balance);
      const totalPaid = await staking.getUserTotalPaid(owner.address);
      const walletBalanceAfter = await wallet.provider.getBalance(wallet.address);
      
      // console.info(`    ${wallet.address} owner BNB balance(after): ${formatEther(balanceAfter)}`);
      // console.info(`    ${contractAddress} contract BNB balance(after): ${formatEther(stakingBalanceAfter)}`);
      // console.info(`    ${wallet.address} wallet BNB balance(after): ${formatEther(walletBalanceAfter)}`);
      // console.info(`          totalPaid: $${formatUnits(totalPaid, 18)}`);
      
      expect(walletBalanceAfter).to.be.greaterThan(walletBalance);
      expect(totalPaid).to.be.greaterThan(zero);
    })

    it("Should be success buy with BNB 2 times with withdraw", async function () {
      const { staking } = await loadFixture(deployStaking);
      const zero = parseUnits("0", 18);
      const [owner, wallet] = await ethers.getSigners();
      const balance = await owner.provider.getBalance(owner.address);
      const walletBalance = await wallet.provider.getBalance(wallet.address);
      const contractAddress = await staking.getAddress();
      const stakingBalance = await owner.provider.getBalance(contractAddress);
      expect(balance).to.not.equal(zero);
      // console.info(`    ${owner.address} owner BNB balance: ${formatEther(balance)}`);
      // console.info(`    ${wallet.address} wallet BNB balance: ${formatEther(walletBalance)}`);
      // console.info(`    ${contractAddress} contract BNB balance: ${formatEther(stakingBalance)}`);
      const amount = parseUnits("1", 18);

      const tokens = await staking.getSupportedTokensInfo(owner.address);
      expect(tokens[3].balance).to.be.equal(balance);
      await expect(staking.buyAndStake(0, BNB, ZERO_ADDRESS, { value: amount })).not.to.be
        .reverted;
      const stakingBalanceAfter = await owner.provider.getBalance(contractAddress);
      const balanceAfter = await wallet.provider.getBalance(owner.address);
      expect(balanceAfter).to.be.lessThan(balance);

      const depositAmount = await staking.balanceOf(owner.address);
      expect(depositAmount).to.be.greaterThan(0);
      const endStakingTime = await staking.endStakingTime(owner.address);
      expect(endStakingTime).to.be.greaterThan(0);

      await time.increase(60);//second buy after 1 min
      
      await expect(staking.buyAndStake(0, BNB, ZERO_ADDRESS, { value: amount })).not.to.be
      .reverted;

      const endStakingTime2 = await staking.endStakingTime(owner.address);
      expect(endStakingTime2).to.be.greaterThan(endStakingTime);
      const canWithdraw = await staking.canWithdraw(owner.address);
      expect(canWithdraw).to.be.false;

      await time.increase(8640000);//100 days
      const depositAmount2 = await staking.balanceOf(owner.address);
      expect(depositAmount2).to.be.greaterThan(depositAmount);
      const canWithdraw2 = await staking.canWithdraw(owner.address);
      expect(canWithdraw2).to.be.true;
      await expect(staking.withdraw()).not.to.be.reverted;
      const endStakingTime3 = await staking.endStakingTime(owner.address);
      expect(endStakingTime3).to.be.eq(0);
      const canWithdraw3 = await staking.canWithdraw(owner.address);
      expect(canWithdraw3).to.be.false;
      const depositAmount3 = await staking.balanceOf(owner.address);
      expect(depositAmount3).to.be.eq(0);
      

      const totalPaid = await staking.getUserTotalPaid(owner.address);
      const walletBalanceAfter = await wallet.provider.getBalance(wallet.address);
      
      // console.info(`    ${wallet.address} owner BNB balance(after): ${formatEther(balanceAfter)}`);
      // console.info(`    ${contractAddress} contract BNB balance(after): ${formatEther(stakingBalanceAfter)}`);
      // console.info(`    ${wallet.address} wallet BNB balance(after): ${formatEther(walletBalanceAfter)}`);
      // console.info(`          totalPaid: $${formatUnits(totalPaid, 18)}`);
      
      expect(walletBalanceAfter).to.be.greaterThan(walletBalance);
      expect(totalPaid).to.be.greaterThan(zero);
    })

    it("Should be success buy and stake with USDT", async function () {
      const { staking } = await loadFixture(deployStaking);
      const zero = parseUnits("0", 18);
      expect(await app_token.balanceOf(staking)).to.equal(parseUnits("100000000", 18));
      const [owner] = await ethers.getSigners();
      const balance = await topupTokenFromNetwork(USDT_ADDRESS, 10000, owner);
      expect(await usdt_token.balanceOf(owner.address)).to.not.equal(zero);
      // console.info(
      //   `         ${owner.address} USDT balance: ${formatUnits(balance, 6)}`
      // );

      const meta = IERC20Metadata__factory.connect(
        await usdt_token.getAddress(),
        owner
      );
      var decimals = await meta.decimals();
      const amount = parseUnits("100", decimals);

      const tx = await usdt_token.approve(await staking.getAddress(), amount);
      await tx.wait();
      const tokens = await staking.getSupportedTokensInfo(owner.address);
      expect(tokens[0].balance).to.be.equal(balance);
      expect(tokens[0].allowance).to.be.equal(amount);
      //console.log(tokens[1]);
      await expect(staking.buyAndStake(amount, USDT_ADDRESS, ZERO_ADDRESS)).not.to.be
        .reverted;
      const totalPaid = await staking.getUserTotalPaid(owner.address);
      //console.info(`          totalPaid: $${formatUnits(totalPaid, 18)}`);
      expect(totalPaid).to.be.gte(amount);
    })


    it("Should be success buy and stake with DAI", async function () {
      const { staking } = await loadFixture(deployStaking);
      const zero = parseUnits("0", 18);
      expect(await app_token.balanceOf(staking)).to.not.equal(zero);
      const [owner] = await ethers.getSigners();
      const balance = await topupTokenFromNetwork(DAI_ADDRESS, 10000, owner);
      expect(await dai_token.balanceOf(owner.address)).to.not.equal(zero);
      // console.info(
      //   `     ${owner.address} DAI balance: ${formatUnits(balance, 18)}`
      // );

      const meta = IERC20Metadata__factory.connect(
        await dai_token.getAddress(),
        owner
      );
      var decimals = await meta.decimals();
      const amount = parseUnits("100", decimals);

      const tx = await dai_token.approve(await staking.getAddress(), amount);
      await tx.wait();
      await expect(staking.buyAndStake(amount, DAI_ADDRESS, ZERO_ADDRESS)).not.to.be.reverted;
    });

    it("Should be reverted stake with App token", async function () {
      const { staking } = await loadFixture(deployStaking);
      const zero = parseUnits("0", 18);
      expect(await app_token.balanceOf(staking)).to.not.equal(zero);
      const [owner] = await ethers.getSigners();
      const balance = await app_token.balanceOf(owner.address);
      expect(balance).to.not.equal(zero);
      // console.info(
      //   `     ${owner.address} App token balance: ${formatUnits(balance, 18)}`
      // );

      const meta = IERC20Metadata__factory.connect(
        await app_token.getAddress(),
        owner
      );
      var decimals = await meta.decimals();
      const amount = parseUnits("1000", decimals);

      const tx = await app_token.approve(await staking.getAddress(), amount);
      await tx.wait();
      await expect(staking.buyAndStake(amount, await app_token.getAddress(), ZERO_ADDRESS))
        .to.be.reverted;
    });

    it("Should be success buy and stake with USDT and add new round", async function () {
      const { staking } = await loadFixture(deployStaking);
      const zero = parseUnits("0", 18);
      expect(await app_token.balanceOf(staking)).to.equal(parseUnits("100000000", 18));
      const [owner] = await ethers.getSigners();
      const balance = await topupTokenFromNetwork(USDT_ADDRESS, 1_000_000, owner);
      expect(await usdt_token.balanceOf(owner.address)).to.not.equal(zero);
      // console.info(
      //   `         ${owner.address} USDT balance: ${formatUnits(balance, 6)}`
      // );

      const meta = IERC20Metadata__factory.connect(
        await usdt_token.getAddress(),
        owner
      );
      var decimals = await meta.decimals();
      const amount = parseUnits("240000", decimals);
      
      const tx = await usdt_token.approve(await staking.getAddress(), amount);
      await tx.wait();
      const tokens = await staking.getSupportedTokensInfo(owner.address);
      expect(tokens[0].balance).to.be.equal(balance);
      expect(tokens[0].allowance).to.be.equal(amount);

      let curRound = await staking.getCurrentRound();
      expect(curRound.index).to.be.equal(0);
      expect(curRound.price).to.be.equal(parseUnits("0.01", 18));
      expect(curRound.ts).to.be.eq(0);

      await expect(staking.buyAndStake(amount, USDT_ADDRESS, ZERO_ADDRESS)).not.to.be
        .reverted;
      const totalPaid = await staking.getUserTotalPaid(owner.address);
      expect(totalPaid).to.be.gte(amount);
      
      let roundSold = (await staking.rounds(0)).totalSold;
      //console.info(`          round 0: $${formatUnits(roundSold, 18)}`);
      expect(roundSold).to.be.gte(parseUnits("239000",18))
      //add more
      const amount2 = parseUnits("100000", decimals);
      const tx2 = await usdt_token.approve(await staking.getAddress(), amount2);
      await tx2.wait();
      await expect(staking.buyAndStake(amount2, USDT_ADDRESS, ZERO_ADDRESS)).not.to.be
       .reverted;
      
      let totalSold = await staking.totalsSold();
      expect(totalSold).to.be.gte(parseUnits("339000",18));
      roundSold = (await staking.rounds(0)).totalSold;
      //console.info(`          round 0: $${formatUnits(roundSold, 18)}`);
      expect(roundSold).to.be.gte(parseUnits("239000",18))
      expect((await staking.rounds(0)).stopped).to.be.true;
      

      curRound = await staking.getCurrentRound();
      expect(curRound.index).to.be.equal(1);
      expect(curRound.price).to.be.equal(parseUnits("0.03", 18));
      expect(curRound.stopped).to.be.false;
      expect(curRound.ts).to.be.greaterThan(0);

      // add more staking to create new round
      const tx3 = await usdt_token.approve(await staking.getAddress(), amount);
      await tx3.wait();
      await expect(staking.buyAndStake(amount, USDT_ADDRESS, ZERO_ADDRESS)).not.to.be
      .reverted;
      curRound = await staking.getCurrentRound();
      expect(curRound.index).to.be.equal(1);

      totalSold = await staking.totalsSold();
      expect(totalSold).to.be.gte(parseUnits("579000",18));
      
      roundSold = (await staking.rounds(0)).totalSold;
      console.info(`          round 0: $${formatUnits(roundSold, 18)}`);
      

      const tx4 = await usdt_token.approve(await staking.getAddress(), amount2);
      await tx4.wait();
      await expect(staking.buyAndStake(amount2, USDT_ADDRESS, ZERO_ADDRESS)).not.to.be
       .reverted;

      totalSold = await staking.totalsSold();
      expect(totalSold).to.be.gte(parseUnits("679000",18));
      roundSold = (await staking.rounds(1)).totalSold;
      console.info(`          round 1: $${formatUnits(roundSold, 18)}`);
      
      const days15Sec = 1296000n;
      curRound = await staking.getCurrentRound();
      expect(curRound.index).to.be.equal(2);
      expect(curRound.price).to.be.equal(parseUnits("0.06", 18));
      expect(curRound.ts).to.be.lessThan(+(Date.now() + 1296000).toFixed());
      expect(curRound.ts + days15Sec).to.be.lessThanOrEqual(+(Date.now()/1000 + 1296000).toFixed());
      totalSold = await staking.totalsSold();
      expect(totalSold).to.be.gte(parseUnits("679000",18));
      roundSold = (await staking.rounds(2)).totalSold;
      console.info(`          round 2: $${formatUnits(roundSold, 18)}`);

    })

    it("Should be success buy and stake with USDT with skipped by time rounds", async function () {
      const { staking } = await loadFixture(deployStaking);
      const zero = parseUnits("0", 18);
      expect(await app_token.balanceOf(staking)).to.equal(parseUnits("100000000", 18));
      const [owner] = await ethers.getSigners();
      const balance = await topupTokenFromNetwork(USDT_ADDRESS, 1_000_000, owner);
      expect(await usdt_token.balanceOf(owner.address)).to.not.equal(zero);
     
      const meta = IERC20Metadata__factory.connect(
        await usdt_token.getAddress(),
        owner
      );
      var decimals = await meta.decimals();
      const amount = parseUnits("5000", decimals);
      
      const tx = await usdt_token.approve(await staking.getAddress(), amount);
      await tx.wait();
      const tokens = await staking.getSupportedTokensInfo(owner.address);
      expect(tokens[0].balance).to.be.equal(balance);
      expect(tokens[0].allowance).to.be.equal(amount);

      let curRound = await staking.getCurrentRound();
      expect(curRound.index).to.be.equal(0);
      expect(curRound.price).to.be.equal(parseUnits("0.01", 18));
      expect(curRound.ts).to.be.eq(0);

      await expect(staking.buyAndStake(amount, USDT_ADDRESS, ZERO_ADDRESS)).not.to.be
        .reverted;
      const totalPaid = await staking.getUserTotalPaid(owner.address);
      expect(totalPaid).to.be.gte(amount);
      
      let roundSold = (await staking.rounds(0)).totalSold;
      expect(roundSold).to.be.gte(parseUnits("4900",18))
      const daySeconds = 86400;
      await time.increase(daySeconds * 50);
      curRound = await staking.getCurrentRound();
      const start = await staking.start();
      expect(curRound.index).to.be.equal(3);
      expect(curRound.price).to.be.equal(parseUnits("0.09", 18));
      expect(curRound.ts).to.be.eq(start + BigInt(3 * daySeconds *15));

      //add more
      const amount2 = parseUnits("1000", decimals);
      const tx2 = await usdt_token.approve(await staking.getAddress(), amount2);
      await tx2.wait();
      await expect(staking.buyAndStake(amount2, USDT_ADDRESS, ZERO_ADDRESS)).not.to.be
       .reverted;
      
      let totalSold = await staking.totalsSold();
      expect(totalSold).to.be.gte(parseUnits("5900",18));
      for (let index = 0; index < 4; index++) {
        roundSold = (await staking.rounds(index)).totalSold;
        console.info(`          round ${index}: $${formatUnits(roundSold, 18)}`);
      }
      curRound = await staking.getCurrentRound();
      expect(curRound.index).to.be.equal(3);
      expect(curRound.price).to.be.equal(parseUnits("0.09", 18));
      expect(curRound.stopped).to.be.false;
      expect(curRound.ts).to.be.eq(start + BigInt(3 * daySeconds *15));
    })
   
  });
});
