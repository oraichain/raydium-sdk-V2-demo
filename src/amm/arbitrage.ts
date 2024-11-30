import { ApiV3PoolInfoStandardItem, AmmV4Keys, AmmRpcData, Raydium, AmmV5Keys } from '@raydium-io/raydium-sdk-v2'
import { initSdk, txVersion } from '../config'
import BN from 'bn.js'
import { isValidAmm } from './utils'
import Decimal from 'decimal.js'

export class SimpleRaydiumArbitrager {
  private constructor(
    private raydium: Raydium,
    private poolKeys: AmmV4Keys | AmmV5Keys,
    private rpcData: AmmRpcData,
    private poolInfo: ApiV3PoolInfoStandardItem
  ) {}

  static async connect(poolId: string) {
    const raydium = await initSdk()
    const data = await raydium.api.fetchPoolById({ ids: poolId })
    const poolInfo = data[0] as ApiV3PoolInfoStandardItem
    if (!isValidAmm(poolInfo.programId)) throw new Error('target pool is not AMM pool')

    const poolKeys = await raydium.liquidity.getAmmPoolKeys(poolId)
    const rpcData = await raydium.liquidity.getRpcPoolInfo(poolId)

    return new SimpleRaydiumArbitrager(raydium, poolKeys, rpcData, poolInfo)
  }

  simulateAmountOut(inputMint: string, amountIn: number) {
    if (!this.poolKeys || !this.rpcData || !this.poolInfo)
      throw new Error('You need to initialize the arbitrager first')

    const [baseReserve, quoteReserve, status] = [
      this.rpcData.baseReserve,
      this.rpcData.quoteReserve,
      this.rpcData.status.toNumber(),
    ]

    if (this.poolInfo.mintA.address !== inputMint && this.poolInfo.mintB.address !== inputMint)
      throw new Error('input mint does not match pool')

    const baseIn = inputMint === this.poolInfo.mintA.address
    const [mintIn, mintOut] = baseIn
      ? [this.poolInfo.mintA, this.poolInfo.mintB]
      : [this.poolInfo.mintB, this.poolInfo.mintA]

    const out = this.raydium.liquidity.computeAmountOut({
      poolInfo: {
        ...this.poolInfo,
        baseReserve,
        quoteReserve,
        status,
        version: 4,
      },
      amountIn: new BN(amountIn),
      mintIn: mintIn.address,
      mintOut: mintOut.address,
      slippage: 0.01, // range: 1 ~ 0.0001, means 100% ~ 0.01%
    })
    return { out, mintIn, mintOut }
  }

  async arbitrage(inputMint: string, amountIn: number) {
    const { out, mintIn, mintOut } = this.simulateAmountOut(inputMint, amountIn)

    console.log(
      `computed swap ${new Decimal(amountIn)
        .div(10 ** mintIn.decimals)
        .toDecimalPlaces(mintIn.decimals)
        .toString()} ${mintIn.symbol || mintIn.address} to ${new Decimal(out.amountOut.toString())
        .div(10 ** mintOut.decimals)
        .toDecimalPlaces(mintOut.decimals)
        .toString()} ${mintOut.symbol || mintOut.address}, minimum amount out ${new Decimal(out.minAmountOut.toString())
        .div(10 ** mintOut.decimals)
        .toDecimalPlaces(mintOut.decimals)} ${mintOut.symbol || mintOut.address}`
    )

    const { execute } = await this.raydium.liquidity.swap({
      poolInfo: this.poolInfo,
      poolKeys: this.poolKeys,
      amountIn: new BN(amountIn),
      amountOut: out.minAmountOut, // out.amountOut means amount 'without' slippage
      fixedSide: 'in',
      inputMint: mintIn.address,
      txVersion,

      // optional: set up token account
      // config: {
      //   inputUseSolBalance: true, // default: true, if you want to use existed wsol token account to pay token in, pass false
      //   outputUseSolBalance: true, // default: true, if you want to use existed wsol token account to receive token out, pass false
      //   associatedOnly: true, // default: true, if you want to use ata only, pass true
      // },

      // optional: set up priority fee here
      computeBudgetConfig: {
        units: 600000,
        microLamports: 46591500,
      },
    })

    // don't want to wait confirm, set sendAndConfirm to false or don't pass any params to execute
    const { txId } = await execute({ sendAndConfirm: true })
    console.log(`swap successfully in amm pool:`, { txId: `https://explorer.solana.com/tx/${txId}` })

    // process.exit() // if you don't want to end up node execution, comment this line
  }
}

export class SimpleOraiDEXArbitrager {
  // TODO: copy paste dex arbitrage logic here
  simulateAmountOut(inputMint: string, amountIn: number) {
    return 0
  }
}

export class SimpleRaydiumOraiDexArbitrager {
  constructor(
    private readonly raydiumArbitrager: SimpleRaydiumArbitrager,
    private readonly oraidexArbitrager: SimpleOraiDEXArbitrager
  ) {}

  async arbitrage(inputMint: string, amountIn: number) {
    const raydiumOut = this.raydiumArbitrager.simulateAmountOut(inputMint, amountIn)
    const oraidexOut = this.oraidexArbitrager.simulateAmountOut(inputMint, amountIn)

    // check condition then arbitrage
    // if something
    // await this.raydiumArbitrager.arbitrage()
    // await this.oraidexArbitrager.arbitrage()
  }
}
