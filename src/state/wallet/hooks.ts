import { useEffect, useMemo, useState } from 'react'
import ERC20_INTERFACE from '../../constants/abis/erc20'
import { useActiveWeb3React } from '../../hooks'
import { useBytes32TokenContract, useMulticallContract, useTokenContract } from '../../hooks/useContract'
import { getContract, isAddress } from '../../utils'
import {
  useSingleContractMultipleData,
  useMultipleContractSingleData,
  NEVER_RELOAD,
  useSingleCallResult
} from '../multicall/hooks'
import { CurrencyAmount, TokenAmount } from '../../constants/token/fractions'
import JSBI from 'jsbi'
import { Currency, ETHER, Token } from '../../constants/token'
import { BAST_TOKEN } from '../../constants'
import { ChainId } from 'constants/chain'
import { arrayify, parseBytes32String } from 'ethers/lib/utils'
import { getOtherNetworkLibrary } from 'connectors/MultiNetworkConnector'
import ERC20_ABI from 'constants/abis/erc20.json'

/**
 * Returns a map of the given addresses to their eventually consistent ETH balances.
 */
export function useETHBalances(
  uncheckedAddresses?: (string | undefined)[]
): { [address: string]: CurrencyAmount | undefined } {
  const multicallContract = useMulticallContract()

  const addresses: string[] = useMemo(
    () =>
      uncheckedAddresses
        ? uncheckedAddresses
            .map(isAddress)
            .filter((a): a is string => a !== false)
            .sort()
        : [],
    [uncheckedAddresses]
  )

  const results = useSingleContractMultipleData(
    multicallContract,
    'getEthBalance',
    addresses.map(address => [address])
  )

  return useMemo(
    () =>
      addresses.reduce<{ [address: string]: CurrencyAmount }>((memo, address, i) => {
        const value = results?.[i]?.result?.[0]
        if (value) memo[address] = CurrencyAmount.ether(JSBI.BigInt(value.toString()))
        return memo
      }, {}),
    [addresses, results]
  )
}

/**
 * Returns a map of token addresses to their eventually consistent token balances for a single account.
 */
export function useTokenBalancesWithLoadingIndicator(
  address?: string,
  tokens?: (Token | undefined)[]
): [{ [tokenAddress: string]: TokenAmount | undefined }, boolean] {
  const validatedTokens: Token[] = useMemo(
    () => tokens?.filter((t?: Token): t is Token => isAddress(t?.address) !== false) ?? [],
    [tokens]
  )

  const validatedTokenAddresses = useMemo(() => validatedTokens.map(vt => vt.address), [validatedTokens])

  const balances = useMultipleContractSingleData(validatedTokenAddresses, ERC20_INTERFACE, 'balanceOf', [address])

  const anyLoading: boolean = useMemo(() => balances.some(callState => callState.loading), [balances])

  return [
    useMemo(
      () =>
        address && validatedTokens.length > 0
          ? validatedTokens.reduce<{ [tokenAddress: string]: TokenAmount | undefined }>((memo, token, i) => {
              const value = balances?.[i]?.result?.[0]
              const amount = value ? JSBI.BigInt(value.toString()) : undefined
              if (amount) {
                memo[token.address] = new TokenAmount(token, amount)
              }
              return memo
            }, {})
          : {},
      [address, validatedTokens, balances]
    ),
    anyLoading
  ]
}

export function useTokenBalances(
  address?: string,
  tokens?: (Token | undefined)[]
): { [tokenAddress: string]: TokenAmount | undefined } {
  return useTokenBalancesWithLoadingIndicator(address, tokens)[0]
}

// get the balance for a single token/account combo
export function useTokenBalance(account?: string, token?: Token): TokenAmount | undefined {
  const tokenBalances = useTokenBalances(account, [token])
  if (!token) return undefined
  return tokenBalances[token.address]
}

export function useCurrencyBalances(
  account?: string,
  currencies?: (Currency | undefined)[]
): (CurrencyAmount | undefined)[] {
  const tokens = useMemo(() => currencies?.filter((currency): currency is Token => currency instanceof Token) ?? [], [
    currencies
  ])

  const tokenBalances = useTokenBalances(account, tokens)
  const containsETH: boolean = useMemo(() => currencies?.some(currency => currency === ETHER) ?? false, [currencies])
  const ethBalance = useETHBalances(containsETH ? [account] : [])

  return useMemo(
    () =>
      currencies?.map(currency => {
        if (!account || !currency) return undefined
        if (currency instanceof Token) return tokenBalances[currency.address]
        if (currency === ETHER) return ethBalance[account]
        return undefined
      }) ?? [],
    [account, currencies, ethBalance, tokenBalances]
  )
}

export function useCurrencyBalance(account?: string, currency?: Currency): CurrencyAmount | undefined {
  return useCurrencyBalances(account, [currency])[0]
}

export function useBaseTokenBalance(): TokenAmount | undefined {
  const { account, chainId } = useActiveWeb3React()

  const base = chainId ? BAST_TOKEN[chainId] : undefined

  const baseBalance: TokenAmount | undefined = useTokenBalance(account ?? undefined, base)

  if (!base) return undefined

  return baseBalance
}

// parse a name or symbol from a token response
const BYTES32_REGEX = /^0x[a-fA-F0-9]{64}$/

function parseStringOrBytes32(str: string | undefined, bytes32: string | undefined, defaultValue: string): string {
  return str && str.length > 0
    ? str
    : // need to check for proper bytes string and valid terminator
    bytes32 && BYTES32_REGEX.test(bytes32) && arrayify(bytes32)[31] === 0
    ? parseBytes32String(bytes32)
    : defaultValue
}

export function useToken(tokenAddress: string, chainId?: ChainId): Token | undefined | null {
  const { chainId: linkChainId } = useActiveWeb3React()
  const curChainId = chainId || linkChainId

  const address = isAddress(tokenAddress)

  const tokenContract = useTokenContract(address ? address : undefined, false)
  const tokenContractBytes32 = useBytes32TokenContract(address ? address : undefined, false)

  const tokenName = useSingleCallResult(tokenContract, 'name', undefined, NEVER_RELOAD, curChainId)
  const tokenNameBytes32 = useSingleCallResult(tokenContractBytes32, 'name', undefined, NEVER_RELOAD, curChainId)
  const symbol = useSingleCallResult(tokenContract, 'symbol', undefined, NEVER_RELOAD, curChainId)
  const symbolBytes32 = useSingleCallResult(tokenContractBytes32, 'symbol', undefined, NEVER_RELOAD, curChainId)
  const decimals = useSingleCallResult(tokenContract, 'decimals', undefined, NEVER_RELOAD, curChainId)

  return useMemo(() => {
    if (!curChainId || !address) return undefined
    if (decimals.loading || symbol.loading || tokenName.loading) return null
    if (decimals.result) {
      return new Token(
        curChainId,
        address,
        decimals.result[0],
        parseStringOrBytes32(symbol.result?.[0], symbolBytes32.result?.[0], 'UNKNOWN'),
        parseStringOrBytes32(tokenName.result?.[0], tokenNameBytes32.result?.[0], 'Unknown Token')
      )
    }
    return undefined
  }, [
    address,
    curChainId,
    decimals.loading,
    decimals.result,
    symbol.loading,
    symbol.result,
    symbolBytes32.result,
    tokenName.loading,
    tokenName.result,
    tokenNameBytes32.result
  ])
}

export function useTokenByChain(
  tokenAddress: string | undefined,
  curChainId: ChainId | undefined
):
  | undefined
  | {
      token: Token
      totalSupply: TokenAmount
    } {
  const [name, setName] = useState<string>()
  const [decimals, setDecimals] = useState<number>()
  const [symbol, setSymbol] = useState<string>()
  const [totalSupply, setTotalSupply] = useState<string>()

  const contract = useMemo(() => {
    if (!tokenAddress || !curChainId) return undefined
    const library = getOtherNetworkLibrary(curChainId)
    if (!library) return undefined
    return getContract(tokenAddress, ERC20_ABI, library, undefined)
  }, [curChainId, tokenAddress])

  useEffect(() => {
    if (!contract) {
      setName(undefined)
      setSymbol(undefined)
      setDecimals(undefined)
      return
    }
    contract
      .name()
      .then((res: string) => setName(res))
      .catch(() => setName(undefined))
    contract
      .symbol()
      .then((res: string) => setSymbol(res))
      .catch(() => setSymbol(undefined))
    contract
      .decimals()
      .then((res: number) => setDecimals(res))
      .catch(() => setDecimals(undefined))
    contract
      .totalSupply()
      .then((res: string) => setTotalSupply(res.toString()))
      .catch(() => setTotalSupply(undefined))
  }, [contract])

  return useMemo(() => {
    if (!contract || !curChainId || !tokenAddress) return undefined
    if (!name || !symbol || !decimals) return undefined
    const token = new Token(curChainId, tokenAddress, decimals, symbol, name)
    return {
      token,
      totalSupply: new TokenAmount(token, totalSupply || '0')
    }
  }, [contract, curChainId, decimals, name, symbol, tokenAddress, totalSupply])
}
