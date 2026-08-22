/**
 * Generate a fresh BIP-39 seed phrase for the party's donation wallet.
 * Testnet only. Paste it into .env as WDK_SEED_PHRASE and never commit it.
 */
import WDK from '@tetherto/wdk'

const seedPhrase = WDK.getRandomSeedPhrase(24)

if (!WDK.isValidSeed(seedPhrase)) {
  console.error('Generated an invalid seed phrase — refusing to print it.')
  process.exit(1)
}

console.log(`\n  WDK_SEED_PHRASE="${seedPhrase}"\n`)
console.log('  Paste into .env. Testnet only — this is not a production key.\n')
