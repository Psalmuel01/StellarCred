require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

module.exports = {
  dbClient: required('DB_CLIENT', 'sqlite'),
  sqlitePath: required('SQLITE_PATH', './data/indexer.db'),
  databaseUrl: required('DATABASE_URL', ''),
  rpcUrl: required('RPC_URL', 'https://soroban-testnet.stellar.org'),
  networkPassphrase: required('NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015'),
  contractId: required('PROOF_REGISTRY_CONTRACT_ID', ''),
  pollIntervalMs: parseInt(required('POLL_INTERVAL_MS', '5000'), 10),
  eventPageLimit: parseInt(required('EVENT_PAGE_LIMIT', '100'), 10),
  startLedger: parseInt(required('START_LEDGER', '0'), 10),
  port: parseInt(required('PORT', '4100'), 10),
};
