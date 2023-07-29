const express = require('express');
const axios = require('axios');
const { ethers } = require("ethers");
const QuoterABI = require('@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json');
const { Pool } = require('@uniswap/v3-sdk/');
const { Token, BigNumber } = require('@uniswap/sdk-core');
const IUniswapV3Pool = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json');
const IUniswapV3Factory = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json');
require('dotenv').config();
const ERC20_abi = require("./ERC20_abi.json");



const app = express();
const PORT = 3000; // You can change this port to any desired port number

// Function to get the latest Matic price
const getMaticPrice = async function () {
  const apiKey = '8N74973SQT95C71M2QPX34PVKR5TD84WC4';
  const url = `https://api.polygonscan.com/api?module=stats&action=maticprice&apikey=${apiKey}`;

  try {
    const response = await axios.get(url);
    const maticPrice = parseFloat(response.data.result.maticusd);
    return maticPrice;
  } catch (error) {
    console.error('Error occurred:', error);
    return 0.0;
  }
};

// Route to get the latest Matic price
app.get('/', async (req, res) => {
  try {
    //const maticPrice = await getMaticPrice();
    const calc = await getUniswapData();
    console.log(calc)
    res.json(calc);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Matic price' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on  http://localhost:${PORT}`);
 // getUniswapData();

});

async function getUniswapData() {
  try {
      const chainId = 80001;
      const walletAddress = '0xE8b7684C7889DaAAdA0D9644d90a871f967366E6';
      const tokenInContractAddress = '0x92B37c3CBb6381c6F5c7016b3638D8426D971846';
      const tokenOutContractAddress = '0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889';
      const { API_URL, PRIVATE_KEY } = process.env;

      const usdAmt = 1;
      console.log(process.env.API_URL)
      console.log(chainId)
      const provider = new ethers.providers.JsonRpcProvider(API_URL, chainId);

      const signer = new ethers.Wallet(PRIVATE_KEY, provider);

      const contractIn = new ethers.Contract(tokenInContractAddress, ERC20_abi, signer);
      const contractOut = new ethers.Contract(tokenOutContractAddress, ERC20_abi, signer);

      // ... (remaining code for getting token balances and loading the Uniswap pool)
      const getTokenAndBalance = async function (contract) {
        var [dec, symbol, name, balance] = await Promise.all(
            [
                contract.decimals(),
                contract.symbol(),
                contract.name(),
                contract.balanceOf(walletAddress)
            ]);
    
        return [new Token(chainId, contract.address, dec, symbol, name), balance];
    };

    const [tokenIn, balanceTokenIn] = await getTokenAndBalance(contractIn);
    const [tokenOut, balanceTokenOut] = await getTokenAndBalance(contractOut);

    console.log(`Wallet ${walletAddress} balances:`);
    console.log(`   Input: ${tokenIn.symbol} (${tokenIn.name}): ${ethers.utils.formatUnits(balanceTokenIn, tokenIn.decimals)}`);
    console.log(`   Output: ${tokenOut.symbol} (${tokenOut.name}): ${ethers.utils.formatUnits(balanceTokenOut, tokenOut.decimals)}`);
    console.log("");

         // ============= PART 2 --- get Uniswap pool for pair TokenIn-TokenOut
    console.log("Loading pool information...");

    // this is Uniswap factory, same address on all chains
    // (from https://docs.uniswap.org/protocol/reference/deployments)
    const UNISWAP_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
    const factoryContract = new ethers.Contract(UNISWAP_FACTORY_ADDRESS, IUniswapV3Factory.abi, provider);

    // loading pool smart contract address
    const poolAddress = await factoryContract.getPool(
        tokenIn.address,
        tokenOut.address,
        3000);  // commission - 3%
        if (Number(poolAddress).toString() === "0") // there is no such pool for provided In-Out tokens.
        throw `Error: No pool ${tokenIn.symbol}-${tokenOut.symbol}`;

    const poolContract = new ethers.Contract(poolAddress, IUniswapV3Pool.abi, provider);

    const getPoolState = async function () {
        const [liquidity, slot] = await Promise.all([poolContract.liquidity(), poolContract.slot0()]);

        return {
            liquidity: liquidity,
            sqrtPriceX96: slot[0],
            tick: slot[1],
            observationIndex: slot[2],
            observationCardinality: slot[3],
            observationCardinalityNext: slot[4],
            feeProtocol: slot[5],
            unlocked: slot[6],
        }
    }

    const getPoolImmutables = async function () {
        const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
            poolContract.factory(),
            poolContract.token0(),
            poolContract.token1(),
            poolContract.fee(),
            poolContract.tickSpacing(),
            poolContract.maxLiquidityPerTick(),
        ]);

        return {
            factory: factory,
            token0: token0,
            token1: token1,
            fee: fee,
            tickSpacing: tickSpacing,
            maxLiquidityPerTick: maxLiquidityPerTick,
        }
    }

    // loading immutable pool parameters and its current state (variable parameters)
    const [immutables, state] = await Promise.all([getPoolImmutables(), getPoolState()]);

    const pool = new Pool(
        tokenIn,
        tokenOut,
        immutables.fee,
        state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick
    );


      const maticInUSD = await getMaticPrice();
      const actualMaticPrice = pool.token0Price.toSignificant();

      // Perform calculations
      const glyPrice = 0.30; // Assuming the GLY price is 0.30 USD

      const usdGLY = parseFloat(usdAmt) / glyPrice;
      const usdMatic = parseFloat(usdAmt) / maticInUSD;
      const glyMatic = usdGLY / usdMatic;
      const maticGly = usdMatic / usdGLY;

      const constanVal = maticGly / parseFloat(actualMaticPrice);
      const y = constanVal * parseFloat(actualMaticPrice);
      const thirdrdstep = (y / 0.30) / y;

      console.log("USD", usdAmt, " ===", usdGLY, "GLY")
      console.log("USD", usdAmt, " ===", usdMatic, "MATIC")
      console.log("++++++++++++++++++++++++++++++++")
   
  
      console.log("1 USD =  0.30 USD")
      console.log("1 GLY = ",glyMatic, " MATIC")
      console.log("1 MATIC = ",maticGly, " GLY")
      console.log("++++++++++++++++++++++++++++++++")
  
      console.log("Const  VALUE", constanVal)
      console.log("Y VALUE", y, "MATIC")
      console.log("3rd step", thirdrdstep , "MATIC")
      // Return the calculated values as an object
      return {
          maticInUSD,
          usdGLY,
          usdMatic,
          glyMatic,
          maticGly,
          constanVal,
          y,
          thirdrdstep
      };
  } catch (error) {
      throw error;
  }
}