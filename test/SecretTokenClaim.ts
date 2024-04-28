import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import { expect } from "chai";
import { config as dotenvConfig } from "dotenv";
import {
  Signer,
  ZeroAddress,
  parseUnits
} from "ethers";
import { ethers, network } from "hardhat";
import { resolve } from "path";

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  IERC20,
  IERC20Metadata__factory,
  IERC20__factory,
} from "../typechain-types";

dotenvConfig({ path: resolve(__dirname, ".env") });

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const BNB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

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

describe("SecretTokenClaim test", function () {
  let usdc_token: IERC20;
  let usdt_token: IERC20;
  let dai_token: IERC20;
  let wbtc_token: IERC20;

  before(async () => {
    const [owner] = await ethers.getSigners();
    usdc_token = IERC20__factory.connect(USDC_ADDRESS, owner);
    usdt_token = IERC20__factory.connect(USDT_ADDRESS, owner);
    dai_token = IERC20__factory.connect(DAI_ADDRESS, owner);
    wbtc_token = IERC20__factory.connect(WBTC_ADDRESS, owner);
  });

  async function deployClaimer() {
    const [owner, wallet] = await ethers.getSigners();
    // Contracts are deployed using the first signer/account by default
    const claimerFactory = await ethers.getContractFactory("SecretTokenClaim");
    const claimer = await claimerFactory.deploy();
    return { claimer };
  }

  describe("Deployment", function () {
    it("Should be success deployment", async function () {
      expect(loadFixture(deployClaimer)).not.to.be.reverted;
    });
  });

  describe("Claiming", function () {
    
    it("Should be success claim for created deposit in USDC", async function () {
      const { claimer } = await loadFixture(deployClaimer);
      const zero = parseUnits("0", 18);
      const [owner, acc1] = await ethers.getSigners();
      const token = usdc_token;
      await topupTokenFromNetwork(await token.getAddress(), 100000, owner);
      
      expect(await token.balanceOf(owner.address)).to.not.equal(zero);
      

      const meta = IERC20Metadata__factory.connect(
        await token.getAddress(),
        owner
      );
      var decimals = await meta.decimals();
      const amountToContract = parseUnits("10000", decimals);

      await token.transfer(
        await claimer.getAddress(),
        amountToContract
      );
      expect(await token.balanceOf(claimer)).to.equal(amountToContract);

      //create deposit info
      const secretPhrase = 'get my claim: #1713747649';
      
      const secretHash = ethers.solidityPackedKeccak256(['string'], [secretPhrase]);
      console.log("Secret Hash:", secretHash);
      const sh = await claimer.hash(secretPhrase);
      expect(secretHash).to.be.eq(sh);

      const amountToDeposit = parseUnits('101', decimals);
      const tx = await claimer.deposit(await token.getAddress(), secretHash, amountToDeposit, ZeroAddress);
      await tx.wait();
      const tokenBalance = await claimer.balanceOf(secretHash);
      expect(tokenBalance).to.equal(amountToDeposit);
      
      const tx2 = await claimer.connect(acc1).claim(secretPhrase);
      await tx2.wait();
      //await expect(claimer.connect(acc1).claim(await usdt_token.getAddress(), secretPhrase)).not.to.be.reverted;
      
      expect(await claimer.balanceOf(secretHash)).to.equal(0);
      expect(await token.balanceOf(acc1)).to.equal(amountToDeposit);
    })
   
  });
});
