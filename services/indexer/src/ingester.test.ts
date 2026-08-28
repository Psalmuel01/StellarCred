/**
 * ingester.test.ts — Tests for Horizon contract event parsing and ingestion.
 */

import { parseEvent, createIngester } from "./ingester";
import { createSqliteDb } from "./db";
import type { Db } from "./db";
import type { Config } from "./config";
import { Keypair, Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import os from "os";
import path from "path";
import fs from "fs";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

function makeTopic(sym: string): string {
  return xdr.ScVal.scvSymbol(sym).toXDR("base64");
}

function makeConfig(sqlitePath: string): Config {
  return {
    stellarNetwork: "testnet",
    horizonUrl: "http://127.0.0.1:8000",
    rpcUrl: "http://127.0.0.1:8000",
    proofRegistryContractId: CONTRACT_ID,
    dbDriver: "sqlite",
    sqlitePath,
    databaseUrl: undefined,
    pollIntervalMs: 6000,
    startLedger: 0,
    port: 3001,
  };
}

describe("parseEvent", () => {
  const holderKey = Keypair.random().publicKey();
  const issuerKey = Keypair.random().publicKey();

  it("returns unknown if contract_id does not match", () => {
    const ev = {
      paging_token: "100",
      contract_id: "COTHERCONTRACT",
      topic: [makeTopic("proof_reg"), makeTopic("submitted"), makeTopic("age")],
      value: "",
      ledger: 100,
      ledger_closed_at: "2026-01-01T00:00:00Z",
    };
    expect(parseEvent(ev, CONTRACT_ID)).toEqual({ kind: "unknown" });
  });

  it("returns unknown for unhandled topics", () => {
    const ev = {
      paging_token: "100",
      contract_id: CONTRACT_ID,
      topic: [makeTopic("proof_reg"), makeTopic("something_else")],
      value: "",
      ledger: 100,
      ledger_closed_at: "2026-01-01T00:00:00Z",
    };
    expect(parseEvent(ev, CONTRACT_ID)).toEqual({ kind: "unknown" });
  });

  it("parses parameterized verified event with numeric threshold", () => {
    const structScVal = nativeToScVal({
      holder: Address.fromString(holderKey),
      issuer: Address.fromString(issuerKey),
      verified_at: 1700000000n,
      expiry: 1800000000n,
      threshold: 21n,
    });

    const ev = {
      paging_token: "100",
      contract_id: CONTRACT_ID,
      topic: [makeTopic("proof_reg"), makeTopic("submitted"), makeTopic("age")],
      value: structScVal.toXDR("base64"),
      ledger: 12345,
      ledger_closed_at: "2026-01-01T12:00:00Z",
      source_account: holderKey,
    };

    const parsed = parseEvent(ev, CONTRACT_ID);
    expect(parsed).toEqual({
      kind: "verified",
      holder: holderKey,
      credentialType: "age",
      issuer: issuerKey,
      expiry: 1800000000,
      ledgerSequence: 12345,
      verifiedAt: Math.floor(new Date("2026-01-01T12:00:00Z").getTime() / 1000),
      threshold: 21,
    });
  });

  it("parses parameterized verified event with threshold as number / string", () => {
    const structScVal = nativeToScVal({
      holder: Address.fromString(holderKey),
      issuer: Address.fromString(issuerKey),
      verified_at: 1700000000n,
      expiry: 1800000000n,
      threshold: 50000,
    });

    const ev = {
      paging_token: "100",
      contract_id: CONTRACT_ID,
      topic: [makeTopic("proof_reg"), makeTopic("submitted"), makeTopic("income")],
      value: structScVal.toXDR("base64"),
      ledger: "12345",
      ledger_closed_at: "2026-01-01T12:00:00Z",
      source_account: holderKey,
    };

    const parsed = parseEvent(ev, CONTRACT_ID);
    expect(parsed).toMatchObject({
      kind: "verified",
      credentialType: "income",
      threshold: 50000,
    });
  });

  it("parses verified event without threshold as threshold null (e.g. kyc)", () => {
    const structScVal = nativeToScVal({
      holder: Address.fromString(holderKey),
      issuer: Address.fromString(issuerKey),
      verified_at: 1700000000n,
      expiry: 1800000000n,
    });

    const ev = {
      paging_token: "100",
      contract_id: CONTRACT_ID,
      topic: [makeTopic("proof_reg"), makeTopic("submitted"), makeTopic("kyc")],
      value: structScVal.toXDR("base64"),
      ledger: 12345,
      ledger_closed_at: "2026-01-01T12:00:00Z",
      source_account: holderKey,
    };

    const parsed = parseEvent(ev, CONTRACT_ID);
    expect(parsed).toMatchObject({
      kind: "verified",
      credentialType: "kyc",
      threshold: null,
    });
  });

  it("parses legacy scalar verified event with threshold null", () => {
    const scalarScVal = xdr.ScVal.scvU64(new xdr.Uint64(1800000000n));

    const ev = {
      paging_token: "100",
      contract_id: CONTRACT_ID,
      topic: [makeTopic("proof"), makeTopic("verified")],
      value: scalarScVal.toXDR("base64"),
      ledger: 12345,
      ledger_closed_at: "2026-01-01T12:00:00Z",
      source_account: holderKey,
    };

    const parsed = parseEvent(ev, CONTRACT_ID);
    expect(parsed).toMatchObject({
      kind: "verified",
      holder: holderKey,
      threshold: null,
    });
  });

  it("parses revoked event", () => {
    const structScVal = nativeToScVal({
      holder: Address.fromString(holderKey),
      issuer: Address.fromString(issuerKey),
      revoked_at: 1700000000n,
    });

    const ev = {
      paging_token: "100",
      contract_id: CONTRACT_ID,
      topic: [makeTopic("proof_reg"), makeTopic("revoked"), makeTopic("kyc")],
      value: structScVal.toXDR("base64"),
      ledger: 12345,
      ledger_closed_at: "2026-01-01T12:00:00Z",
    };

    const parsed = parseEvent(ev, CONTRACT_ID);
    expect(parsed).toEqual({
      kind: "revoked",
      holder: holderKey,
      credentialType: "kyc",
    });
  });
});

describe("Ingester ingestion of parameterized claims", () => {
  let db: Db;
  let tmpFile: string;
  let config: Config;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `ingester-test-${Date.now()}-${Math.random()}.db`);
    config = makeConfig(tmpFile);
    db = createSqliteDb(config);
    db.migrate();
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpFile + "-wal"); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpFile + "-shm"); } catch { /* ignore */ }
  });

  it("persists threshold in database during tick() and allows querying by threshold", async () => {
    const holderKey = Keypair.random().publicKey();
    const issuerKey = Keypair.random().publicKey();

    const structScVal = nativeToScVal({
      holder: Address.fromString(holderKey),
      issuer: Address.fromString(issuerKey),
      verified_at: 1700000000n,
      expiry: 1800000000n,
      threshold: 100000n,
    });

    const mockEvent = {
      paging_token: "100000",
      contract_id: CONTRACT_ID,
      topic: [makeTopic("proof_reg"), makeTopic("submitted"), makeTopic("funds")],
      value: structScVal.toXDR("base64"),
      ledger: 100,
      ledger_closed_at: "2026-01-01T12:00:00Z",
      source_account: holderKey,
    };

    // Mock fetch for Horizon endpoint
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes(`/contracts/${CONTRACT_ID}/events`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            _embedded: {
              records: [mockEvent],
            },
          }),
        } as any;
      }
      return { ok: false, status: 404, text: async () => "Not found" } as any;
    });

    try {
      const ingester = createIngester(config, db);
      const processed = await ingester.tick();
      expect(processed).toBe(1);

      const claims = await db.claimsByWallet(holderKey);
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({
        wallet: holderKey,
        credential_type: "funds",
        threshold: 100000,
        revoked: 0,
      });

      // Verify querying / filtering by threshold
      const recent = await db.recent(10, 0);
      expect(recent).toHaveLength(1);
      expect(recent[0].threshold).toBe(100000);
      expect(recent[0].threshold).toBeGreaterThanOrEqual(50000);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
