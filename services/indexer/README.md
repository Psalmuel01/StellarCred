# StellarCred Indexer Service

The **StellarCred Indexer** is a lightweight, high-performance event ingester and query service for StellarCred's on-chain Soroban contracts. It continuously polls Stellar/Soroban RPC endpoints for events emitted by the `ProofRegistry` contract, indexes verification states into a local database (SQLite or PostgreSQL), and serves fast read queries for holders, protocols, and the web app.

---

## Table of Contents

- [Overview & Role in Stack](#overview--role-in-stack)
- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Configuration & Environment Variables](#configuration--environment-variables)
- [Database Options (SQLite vs PostgreSQL)](#database-options-sqlite-vs-postgresql)
- [Testing](#testing)
- [Docker & Container Deployment](#docker--container-deployment)
- [Consistency, Finality & Reorg Guarantees](#consistency-finality--reorg-guarantees)
- [API Endpoints](#api-endpoints)

---

## Overview & Role in Stack

```
   ┌─────────────────────────────────────────────────────────────┐
   │                  Stellar / Soroban RPC                      │
   │    ProofRegistry Contract: emits verification events        │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  │ Polls for contract events
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                 StellarCred Indexer                         │
   │  - Event Ingester & Parser (XDR decoding)                   │
   │  - Cursor tracker (last processed ledger sequence)          │
   │  - Storage layer: SQLite (WAL mode) or PostgreSQL           │
   │  - REST API for holder claims, events, and stats            │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  │ Serves fast queries (<10ms)
                                  ▼
           Frontend Web App / SDK (@stellarcred/sdk)
```

---

## Prerequisites

- **Node.js**: `v18.x` or `v20.x` or higher
- **Package Manager**: `npm` (v9+) or `pnpm`
- **Database**:
  - For development / single-instance: SQLite (bundled via `better-sqlite3`, zero setup required)
  - For production / multi-instance: PostgreSQL 14+

---

## Quickstart

### 1. Install Dependencies

```bash
cd services/indexer
npm install
```

### 2. Configure Environment

Copy the example environment file and configure the contract ID:

```bash
cp .env.example .env
```

Edit `.env` to supply your target `PROOF_REGISTRY_CONTRACT_ID`:

```env
DB_DRIVER=sqlite
SQLITE_PATH=./data/indexer.db
RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
PROOF_REGISTRY_CONTRACT_ID=C... # Your ProofRegistry contract ID on Testnet
PORT=3001
```

### 3. Build & Run

**Development Mode (Build & Start):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm run build
npm start
```

---

## Configuration & Environment Variables

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PROOF_REGISTRY_CONTRACT_ID` | **String** | *Required* | Address (`C...`) of the deployed Soroban `ProofRegistry` contract. |
| `DB_DRIVER` | **String** | `sqlite` | Database driver: `sqlite` or `postgres`. |
| `SQLITE_PATH` | **String** | `./data/indexer.db` | Relative or absolute path to SQLite file (created automatically with WAL mode). |
| `DATABASE_URL` | **String** | `undefined` | PostgreSQL connection URI (e.g. `postgres://user:pass@localhost:5432/indexer`). |
| `RPC_URL` | **String** | `https://soroban-testnet.stellar.org` | Soroban RPC server endpoint for `getEvents` and ledger queries. |
| `HORIZON_URL` | **String** | `https://horizon-testnet.stellar.org` | Horizon server endpoint for Stellar account and ledger data. |
| `STELLAR_NETWORK` | **String** | `testnet` | Target network identifier (`testnet`, `public`, `standalone`, `futurenet`). |
| `START_LEDGER` | **Number** | `0` | Ledger sequence to start indexing from (if 0, starts from latest ledger or recorded cursor). |
| `POLL_INTERVAL_SECONDS` | **Number** | `6` | Polling frequency in seconds. |
| `EVENT_PAGE_LIMIT` | **Number** | `100` | Maximum events fetched per RPC `getEvents` call. |
| `PORT` | **Number** | `3001` | HTTP server port for REST API endpoints. |

---

## Database Options (SQLite vs PostgreSQL)

### SQLite (Default)
- Ideal for local development, CI testing, and single-container deployments.
- Automatically enables **WAL (Write-Ahead Logging)** mode for concurrent reads while indexing.
- SQLite database directory `./data` is automatically created on first launch if it does not exist.

### PostgreSQL
- Recommended for production clusters or cloud deployments requiring high write concurrency.
- Set `DB_DRIVER=postgres` and provide `DATABASE_URL`.
- Schema migrations run automatically upon startup.

---

## Testing

Run unit and integration tests using Jest:

```bash
npm test
```

---

## Docker & Container Deployment

### Build & Run Container

```bash
docker build -t stellarcred-indexer services/indexer
docker run -p 3001:3001 \
  -e PROOF_REGISTRY_CONTRACT_ID=C... \
  -e RPC_URL=https://soroban-testnet.stellar.org \
  stellarcred-indexer
```

### Docker Compose
You can run the indexer alongside PostgreSQL and other services via the root `docker-compose.yml`:

```bash
docker compose up indexer
```

---

## Consistency, Finality & Reorg Guarantees

- **Cursor Progression**: The indexer stores the last successfully processed ledger sequence in database metadata. In the event of a restart, ingestion resumes seamlessly from the saved checkpoint without skipping events.
- **Idempotency**: Ingested events and claim records are keyed by `(contract_id, topic, ledger_sequence, tx_hash)`, making replays and repeated ingestion fully idempotent.
- **Finality**: Stellar consensus achieves deterministic single-slot finality (~5 seconds per ledger). By polling confirmed ledgers via Soroban RPC `getEvents`, the indexer avoids unconfirmed/mempool race conditions.

---

## API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health status, database connection, and latest indexed ledger. |
| `GET` | `/api/claims/:holder` | Returns all active and expired credential claims for a given holder address. |
| `GET` | `/api/claims/:holder/:claimType` | Queries claim verification status for a specific claim type (e.g. `kyc`, `age`). |
| `GET` | `/api/events` | Paginated list of recent verification and registry events. |
| `GET` | `/api/stats` | Aggregate indexer metrics (total verified holders, active claims, event count). |
