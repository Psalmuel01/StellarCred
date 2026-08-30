"use client";

// Holder-side proof history export (CSV / JSON) for personal record-keeping.
//
// Produces a portable, non-sensitive audit trail of what a holder proved and
// when — claim type, verified-at timestamp, expiry, on-chain tx hash, and
// issuer address. It deliberately excludes every private value: no
// credential `value`, `salt`, commitment secret, or any PII. The data is
// built purely from the holder's local state (this browser's localStorage),
// so the export works fully offline with no server round-trip.

import type { Credential } from "./credential";

/**
 * A single non-sensitive proof-history row, shaped for spreadsheets (flat,
 * string-ish values, deterministic field order).
 */
export interface ProofHistoryRow {
  /** Credential claim type, e.g. "kyc", "age", "funds". */
  claimType: string;
  /** Human-readable credential title, e.g. "KYC Complete". */
  title: string;
  /** Unix timestamp (seconds) the proof was submitted on-chain. */
  verifiedAt: number;
  /** ISO-8601 date/time of the on-chain submission (spreadsheet friendly). */
  verifiedAtDate: string;
  /** Unix timestamp (seconds) the proof expires. */
  expiry: number;
  /** ISO-8601 date/time of expiry. */
  expiryDate: string;
  /** On-chain transaction hash of the submitted proof, when known. */
  txHash: string;
  /** Issuer Stellar address that signed this credential. */
  issuer: string;
}

/** Compute the credential's expiry timestamp from its TTL string ("30 days"). */
function expiryTimestamp(cred: Credential): number {
  const ttlSecs =
    (parseInt((cred.expiry ?? "").match(/\d+/)?.[0] ?? "30", 10) || 30) * 86_400;
  return cred.issuedAt + ttlSecs;
}

/** Format a unix-seconds timestamp as an ISO-8601 string ("" when absent). */
function iso(ts: number | undefined): string {
  return ts ? new Date(ts * 1000).toISOString() : "";
}

/**
 * Build proof-history rows from locally stored credentials. Only records
 * that carry a proof submission (`provedAt`) are included — a held-but-never-
 * proved credential has no on-chain history to export.
 */
export function buildProofHistory(creds: Credential[]): ProofHistoryRow[] {
  return creds
    .filter((c) => typeof c.provedAt === "number")
    .map((c) => {
      const exp = c.provedAt ? expiryTimestamp(c) : 0;
      return {
        claimType: c.type,
        title: c.title || c.type,
        verifiedAt: c.provedAt ?? 0,
        verifiedAtDate: iso(c.provedAt),
        expiry: exp,
        expiryDate: iso(exp),
        txHash: c.provedTxHash ?? "",
        issuer: c.issuerId ?? c.issuer ?? "",
      };
    })
    .sort((a, b) => a.verifiedAt - b.verifiedAt);
}

/** Serialize proof history as JSON (pretty-printed for human reading). */
export function proofHistoryToJson(rows: ProofHistoryRow[]): string {
  return JSON.stringify(rows, null, 2);
}

/** Escape a value for CSV (quotes, commas, newlines). */
function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize proof history as CSV with a header row, for spreadsheet import. */
export function proofHistoryToCsv(rows: ProofHistoryRow[]): string {
  const header = [
    "claimType",
    "title",
    "verifiedAt",
    "verifiedAtDate",
    "expiry",
    "expiryDate",
    "txHash",
    "issuer",
  ];
  const lines = rows.map((r) =>
    [
      r.claimType,
      r.title,
      r.verifiedAt,
      r.verifiedAtDate,
      r.expiry,
      r.expiryDate,
      r.txHash,
      r.issuer,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadTextFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download the holder's proof history as JSON. No-op when there is nothing
 * to export.
 */
export function downloadProofHistoryJson(creds: Credential[]): void {
  const rows = buildProofHistory(creds);
  if (rows.length === 0) return;
  downloadTextFile(
    proofHistoryToJson(rows),
    `stellarcred-proof-history-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
  );
}

/**
 * Download the holder's proof history as CSV, ready for spreadsheet import.
 * No-op when there is nothing to export.
 */
export function downloadProofHistoryCsv(creds: Credential[]): void {
  const rows = buildProofHistory(creds);
  if (rows.length === 0) return;
  downloadTextFile(
    proofHistoryToCsv(rows),
    `stellarcred-proof-history-${new Date().toISOString().slice(0, 10)}.csv`,
    "text/csv;charset=utf-8",
  );
}
