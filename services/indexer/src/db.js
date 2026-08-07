const path = require('path');
const fs = require('fs');
const config = require('./config');

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS claim_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  tx_hash TEXT NOT NULL,
  ledger_sequence INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  issuer TEXT,
  expiry_ledger_time INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claim_events_wallet ON claim_events(wallet);
CREATE INDEX IF NOT EXISTS idx_claim_events_ledger ON claim_events(ledger_sequence);
CREATE TABLE IF NOT EXISTS ingest_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_ledger INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO ingest_meta (id, last_ledger) VALUES (1, 0);
`;

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS claim_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  tx_hash TEXT NOT NULL,
  ledger_sequence BIGINT NOT NULL,
  wallet TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  issuer TEXT,
  expiry_ledger_time BIGINT,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_claim_events_wallet ON claim_events(wallet);
CREATE INDEX IF NOT EXISTS idx_claim_events_ledger ON claim_events(ledger_sequence);
CREATE TABLE IF NOT EXISTS ingest_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_ledger BIGINT NOT NULL DEFAULT 0
);
INSERT INTO ingest_meta (id, last_ledger) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
`;

function createSqliteDb() {
  const Database = require('better-sqlite3');
  const dir = path.dirname(config.sqlitePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(config.sqlitePath);
  db.pragma('journal_mode = WAL');
  db.exec(SQLITE_SCHEMA);

  return {
    async getLastLedger() {
      const row = db.prepare('SELECT last_ledger FROM ingest_meta WHERE id = 1').get();
      return row ? row.last_ledger : 0;
    },
    async setLastLedger(seq) {
      db.prepare('UPDATE ingest_meta SET last_ledger = ? WHERE id = 1').run(seq);
    },
    async insertEvent(evt) {
      const revoked = evt.action === 'revoked' ? 1 : 0;
      db.prepare(
        `INSERT OR IGNORE INTO claim_events
         (event_id, tx_hash, ledger_sequence, wallet, credential_type, issuer, expiry_ledger_time, revoked)
         VALUES (@event_id, @tx_hash, @ledger_sequence, @wallet, @credential_type, @issuer, @expiry_ledger_time, @revoked)`
      ).run({
        event_id: evt.eventId,
        tx_hash: evt.txHash,
        ledger_sequence: evt.ledgerSequence,
        wallet: evt.wallet,
        credential_type: evt.credentialType,
        issuer: evt.issuer,
        expiry_ledger_time: evt.expiryLedgerTime,
        revoked,
      });
    },
    async getClaims(wallet) {
      return db
        .prepare(
          `SELECT wallet, credential_type, issuer, expiry_ledger_time, revoked, ledger_sequence, tx_hash
           FROM (
             SELECT *, ROW_NUMBER() OVER (
               PARTITION BY wallet, credential_type
               ORDER BY ledger_sequence DESC, id DESC
             ) AS rn
             FROM claim_events
             WHERE wallet = ?
           ) t
           WHERE rn = 1
           ORDER BY credential_type ASC`
        )
        .all(wallet);
    },
    async getStats() {
      const now = Math.floor(Date.now() / 1000);
      return db
        .prepare(
          `SELECT credential_type,
                  COUNT(*) AS active_count
           FROM (
             SELECT *, ROW_NUMBER() OVER (
               PARTITION BY wallet, credential_type
               ORDER BY ledger_sequence DESC, id DESC
             ) AS rn
             FROM claim_events
           ) t
           WHERE rn = 1
             AND revoked = 0
             AND (expiry_ledger_time IS NULL OR expiry_ledger_time > ?)
           GROUP BY credential_type
           ORDER BY credential_type ASC`
        )
        .all(now);
    },
    async getRecent({ limit, offset }) {
      return db
        .prepare(
          `SELECT wallet, credential_type, issuer, expiry_ledger_time, revoked, ledger_sequence, tx_hash, created_at
           FROM claim_events
           ORDER BY ledger_sequence DESC, id DESC
           LIMIT ? OFFSET ?`
        )
        .all(limit, offset);
    },
  };
}

function createPostgresDb() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.databaseUrl });

  async function init() {
    await pool.query(PG_SCHEMA);
  }
  const ready = init();

  return {
    async getLastLedger() {
      await ready;
      const { rows } = await pool.query('SELECT last_ledger FROM ingest_meta WHERE id = 1');
      return rows.length ? Number(rows[0].last_ledger) : 0;
    },
    async setLastLedger(seq) {
      await ready;
      await pool.query('UPDATE ingest_meta SET last_ledger = $1 WHERE id = 1', [seq]);
    },
    async insertEvent(evt) {
      await ready;
      const revoked = evt.action === 'revoked';
      await pool.query(
        `INSERT INTO claim_events
         (event_id, tx_hash, ledger_sequence, wallet, credential_type, issuer, expiry_ledger_time, revoked)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          evt.eventId,
          evt.txHash,
          evt.ledgerSequence,
          evt.wallet,
          evt.credentialType,
          evt.issuer,
          evt.expiryLedgerTime,
          revoked,
        ]
      );
    },
    async getClaims(wallet) {
      await ready;
      const { rows } = await pool.query(
        `SELECT wallet, credential_type, issuer, expiry_ledger_time, revoked, ledger_sequence, tx_hash
         FROM (
           SELECT *, ROW_NUMBER() OVER (
             PARTITION BY wallet, credential_type
             ORDER BY ledger_sequence DESC, id DESC
           ) AS rn
           FROM claim_events
           WHERE wallet = $1
         ) t
         WHERE rn = 1
         ORDER BY credential_type ASC`,
        [wallet]
      );
      return rows;
    },
    async getStats() {
      await ready;
      const now = Math.floor(Date.now() / 1000);
      const { rows } = await pool.query(
        `SELECT credential_type,
                COUNT(*) AS active_count
         FROM (
           SELECT *, ROW_NUMBER() OVER (
             PARTITION BY wallet, credential_type
             ORDER BY ledger_sequence DESC, id DESC
           ) AS rn
           FROM claim_events
         ) t
         WHERE rn = 1
           AND revoked = false
           AND (expiry_ledger_time IS NULL OR expiry_ledger_time > $1)
         GROUP BY credential_type
         ORDER BY credential_type ASC`,
        [now]
      );
      return rows;
    },
    async getRecent({ limit, offset }) {
      await ready;
      const { rows } = await pool.query(
        `SELECT wallet, credential_type, issuer, expiry_ledger_time, revoked, ledger_sequence, tx_hash, created_at
         FROM claim_events
         ORDER BY ledger_sequence DESC, id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return rows;
    },
  };
}

function createDb() {
  if (config.dbClient === 'postgres') return createPostgresDb();
  return createSqliteDb();
}

module.exports = { createDb };
