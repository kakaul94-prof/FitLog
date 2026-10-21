import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Contract, ProviderName } from './types'

export const CONTRACTS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export function contractPath(provider: ProviderName): string {
  return path.join(CONTRACTS_DIR, `fitlog-web--${provider}.json`)
}

/** The committed contract for `provider`, as the consumer tests last wrote it. */
export function readContract(provider: ProviderName): Contract {
  const file = contractPath(provider)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    throw new Error(
      `${path.relative(process.cwd(), file)} is missing. The consumer tests write it: npm run test:contracts`,
    )
  }
  const contract = JSON.parse(raw) as Contract
  if (contract.format !== 'fitlog-contract/1' || contract.provider !== provider)
    throw new Error(`${file} is not a fitlog-contract/1 file for ${provider}`)
  return contract
}

/** Stable, reviewable JSON: two-space indent, trailing newline. */
export function contractJson(contract: Contract): string {
  return `${JSON.stringify(contract, null, 2)}\n`
}
