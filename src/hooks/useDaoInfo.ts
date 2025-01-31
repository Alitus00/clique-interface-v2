import { Token, TokenAmount } from 'constants/token'
import { useMemo } from 'react'
import { VotingTypes } from 'state/buildingGovDao/actions'
import { useToken } from 'state/wallet/hooks'
import { ChainId } from '../constants/chain'
import {
  useSingleCallResult
  // useSingleContractMultipleData
} from '../state/multicall/hooks'
import { useGovernanceDaoContract } from './useContract'

export interface DaoBaseInfoProp {
  name: string
  handle: string
  category: string
  description: string
  twitter: string
  github: string
  website: string
  discord: string
  daoLogo: string
  daoTokenAddress: string
  daoTokenChainId: ChainId
}

export interface DaoInfoProp {
  name: string
  handle: string
  category: string
  description: string
  twitter: string
  github: string
  website: string
  discord: string
  daoLogo: string
  daoTokenAddress: string
  daoTokenChainId: ChainId
  token: Token | undefined
  proposalThreshold: TokenAmount | undefined
  votingThreshold: TokenAmount | undefined
  votingPeriod: number
  votingType: VotingTypes
}

export function useDaoBaseInfo(daoAddress?: string, chainId?: ChainId): DaoBaseInfoProp | undefined {
  const daoContract = useGovernanceDaoContract(daoAddress, chainId)
  const daoInfoRes = useSingleCallResult(daoContract, 'daoInfo', [], undefined, chainId)
  const daoTokenRes = useSingleCallResult(daoContract, 'daoToken', [], undefined, chainId)

  return useMemo(() => {
    const infoRes = daoInfoRes.result
    const tokenRes = daoTokenRes.result
    if (!infoRes || !tokenRes) return undefined
    return {
      name: infoRes.name,
      handle: infoRes.handle,
      category: infoRes.category,
      description: infoRes.description,
      twitter: infoRes.twitter,
      github: infoRes.github,
      discord: infoRes.discord,
      website: infoRes.website,
      daoLogo: infoRes.daoLogo,
      daoTokenAddress: tokenRes.tokenAddress,
      daoTokenChainId: tokenRes.chainId
    }
  }, [daoInfoRes.result, daoTokenRes.result])
}

export function useDaoInfo(daoAddress?: string, chainId?: ChainId): DaoInfoProp | undefined {
  const daoContract = useGovernanceDaoContract(daoAddress, chainId)
  const daoBaseInfo = useDaoBaseInfo(daoAddress, chainId)
  const token = useToken(daoBaseInfo?.daoTokenAddress || '', daoBaseInfo?.daoTokenChainId)
  const daoGovernanceRes = useSingleCallResult(daoContract, 'daoGovernance', [], undefined, chainId)

  return useMemo(() => {
    const governanceRes = daoGovernanceRes.result
    if (!daoBaseInfo || !governanceRes) return undefined
    return {
      ...daoBaseInfo,
      token: token || undefined,
      proposalThreshold: token ? new TokenAmount(token, governanceRes.proposalThreshold) : undefined,
      votingThreshold: token ? new TokenAmount(token, governanceRes.votingQuorum) : undefined,
      votingPeriod: governanceRes.votingPeriod,
      votingType: governanceRes.votingType
    }
  }, [daoBaseInfo, daoGovernanceRes.result, token])
}

export enum DaoAdminLevelProp {
  SUPER_ADMIN,
  ADMIN,
  NORMAL
}

export function useDaoAdminLevel(daoAddress?: string, chainId?: ChainId, account?: string) {
  const daoContract = useGovernanceDaoContract(daoAddress, chainId)

  const adminsRes = useSingleCallResult(account ? daoContract : null, 'admins', [account], undefined, chainId)
    .result?.[0]
  const ownerRes = useSingleCallResult(daoContract, 'owner', [], undefined, chainId).result?.[0]

  return useMemo(() => {
    if (!account || ownerRes === undefined || adminsRes === undefined) return undefined
    if (account && ownerRes && ownerRes.toLowerCase() === account.toLowerCase()) {
      return DaoAdminLevelProp.SUPER_ADMIN
    }
    if (adminsRes) {
      return DaoAdminLevelProp.ADMIN
    }
    return DaoAdminLevelProp.NORMAL
  }, [ownerRes, adminsRes, account])
}
