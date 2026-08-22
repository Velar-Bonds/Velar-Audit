/**
 * Generate a BIP-39 seed for the donor wallets used to seed the chain.
 *
 * Kept separate from the party seed on purpose: the donors are the counterparty
 * in this demonstration, and a system where the audited party also controls the
 * donors would not be demonstrating anything.
 */
import WDK from '@tetherto/wdk'

const seedPhrase = WDK.getRandomSeedPhrase(24)

if (!WDK.isValidSeed(seedPhrase)) {
  console.error('Generated an invalid seed phrase — refusing to print it.')
  process.exit(1)
}

console.log(`\n  DONOR_SEED_PHRASE="${seedPhrase}"\n`)
console.log('  Paste into .env. Testnet only — this is not a production key.\n')
