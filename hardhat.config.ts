import "@nomicfoundation/hardhat-toolbox";
import { config as dotenvConfig } from "dotenv";
import { HardhatUserConfig, task, types } from "hardhat/config";
import { resolve } from "path";

dotenvConfig({ path: resolve(__dirname, ".env") });

// Ensure that we have all the environment variables we need.
let mnemonic = process.env.MNEMONIC as string;
if (!mnemonic) {
  console.warn("Please set your MNEMONIC in a .env file");
  mnemonic =
    "block chain block chain block chain block chain block chain block chain";
}
let infura_key = process.env.INFURA_KEY as string;
if (!infura_key) {
  //console.error("Please set your INFURA_KEY in a .env file");
  throw new Error("Please set your INFURA_KEY in a .env file");
}

import fs from "fs";
import path from "path";

task("mkdir", "create directory if not exist")
  .addOptionalVariadicPositionalParam(
    "dirs",
    "The directories to create",
    undefined,
    types.string
  )
  .setAction(async ({ dirs }, hre) => {
    for (const dir of dirs) {
      const __dirname = path.resolve();
      const pathname = dir.replace(/^\.*\/|\/?[^\/]+\.[a-z]+|\/$/g, ""); // Remove leading directory markers, and remove ending /file-name.extension
      fs.mkdir(path.resolve(__dirname, pathname), { recursive: true }, (e) => {
        if (e) {
          console.error(e);
        } else {
          console.log(`create dir ${pathname}: success!`);
        }
      });
    }
  });

task(
  "flat",
  "Flattens and prints contracts and their dependencies (Resolves licenses)"
)
  .addOptionalVariadicPositionalParam(
    "files",
    "The files to flatten",
    undefined,
    types.inputFile
  )
  .setAction(async ({ files }, hre) => {
    let flattened = await hre.run("flatten:get-flattened-sources", { files });

    // Remove every line started with "// SPDX-License-Identifier:"
    flattened = flattened.replace(
      /SPDX-License-Identifier:/gm,
      "License-Identifier:"
    );
    flattened = `// SPDX-License-Identifier: MIT\n\n${flattened}`;

    // Remove every line started with "pragma experimental ABIEncoderV2;" except the first one
    flattened = flattened.replace(
      /pragma experimental ABIEncoderV2;\n/gm,
      (
        (i) => (m: any) =>
          !i++ ? m : ""
      )(0)
    );
    console.log(flattened);
  });

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      forking: {
        url: `https://mainnet.infura.io/v3/${infura_key}`,
        //blockNumber: 18404000,
        //url: "https://bsc-dataseed.binance.org",
        enabled: true,
      },
    },
    testnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      gasPrice: 20000000000,
      accounts: {
        count: 5,
        initialIndex: 0,
        mnemonic,
        path: "m/44'/60'/0'/0",
      },
    },
    mainnet: {
      url: "https://bsc-dataseed.binance.org",
      chainId: 56,
      gasPrice: 10000000000,
      accounts: {
        count: 1,
        initialIndex: 0,
        mnemonic,
        path: "m/44'/60'/0'/0",
      },
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.24",
    settings: {
      metadata: {
        // Not including the metadata hash
        // https://github.com/paulrberg/solidity-template/issues/31
        bytecodeHash: "none",
      },
      // You should disable the optimizer when debugging
      // https://hardhat.org/hardhat-network/#solidity-optimizer-support
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  mocha: {
    timeout: 100000000,
  },
};

export default config;
