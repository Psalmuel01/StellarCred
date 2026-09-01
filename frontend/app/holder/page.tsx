"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  IconArrowRight,
  IconCertificate,
  IconPlus,
  IconDownload,
} from "@tabler/icons-react";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/lib/wallet-context";
import { ConfigBanner } from "@/components/ConfigBanner";
import { type Credential } from "@/lib/credential";
import { NetworkMismatchBanner } from "@/components/NetworkMismatchBanner";
import { proofSubmissionConfigured } from "@/lib/config";
import { truncateHash } from "@/lib/format";
import { EXPLORER_TX } from "@/lib/stellar";
import { computeWitness, proveWithBackend, withTimeout, ProofTimeoutError, DEFAULT_PROOF_TIMEOUT_MS } from "@/lib/proof";
import { useWarmProver } from "@/lib/use-warm-prover";
import {
  submitProof,
  submitProofs,
  preflightSubmitProof,
  preflightSubmitProofs,
  MAX_BATCH_SIZE,
  parseContractError,
  type ContractError,
  type FeeEstimate,
  type ProofSubmissionParams,
} from "@/lib/contracts";
import {
  type Credential,
  loadCredentials,
  saveCredential,
  removeCredential,
  markProved,
  markAllProved,
  parseCredential,
  exportCredentials,
} from "@/lib/credential";
import { isStorageAvailable } from "@/lib/safe-storage";
import { PREVIEW_CREDENTIALS } from "@/lib/preview-fixtures";
import { usePreviewMode } from "@/lib/wallet-context";
import CredentialDetailModal from "@/components/CredentialDetailModal";
import { useToast } from "@/components/Toast";
import { IMPORT_PARAM } from "@/lib/transfer";
import { PREVIEW_CREDENTIALS } from "@/lib/preview-fixtures";
import dynamic from "next/dynamic";

const TransferExportModal = dynamic(
  () => import("@/components/TransferExportModal").then((m) => m.TransferExportModal),
  { ssr: false },
);
const TransferImportModal = dynamic(
  () => import("@/components/TransferImportModal").then((m) => m.TransferImportModal),
  { ssr: false },
);

// Extracted hooks
import { useCredentialStore } from "@/lib/hooks/useCredentialStore";
import { useBatchSelection } from "@/lib/hooks/useBatchSelection";
import { useImportExport } from "@/lib/hooks/useImportExport";
import {
  proofStatus,
  isExpiringSoon,
  daysRemaining,
} from "@/lib/proof-helpers";

// Extracted subcomponents
import { SectionLabel } from "@/components/holder/SectionLabel";
import { CredCard } from "@/components/holder/CredCard";
import { BatchBar } from "@/components/holder/BatchBar";
import { ImportPanel } from "@/components/holder/ImportPanel";
import { ProofFlowView } from "@/components/holder/ProofFlowView";
import { BatchProofFlowView } from "@/components/holder/BatchProofFlowView";
import { SponsorBanner } from "@/components/holder/SponsorBanner";

// Sponsored submission
import { isSponsorAvailable, submitSponsoredProof } from "@/lib/sponsor";
import { submitProof } from "@/lib/contracts";

// ── Page view state ───────────────────────────────────────────────────────────

type PageView =
  | { kind: "list" }
  | { kind: "single"; cred: Credential }
  | { kind: "batch"; creds: Credential[] };

// ── Holder page (thin orchestrator) ───────────────────────────────────────────
// All state management lives in hooks; all UI lives in subcomponents.

function HolderInner() {
  const { address, connect } = useWallet();
  const isPreview = usePreviewMode();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  // ── Hooks ──────────────────────────────────────────────────────────────────

  const {
    creds,
    save: saveCred,
    remove: removeCred,
    markCredentialProved,
    markCredentialsProved,
  } = useCredentialStore();

  const { downloadBackup } = useImportExport();

  const handleError = useCallback(
    (message: string) => toast.error(message),
    [toast],
  );

  const unprovedAll = isPreview
    ? PREVIEW_CREDENTIALS.filter((c) => proofStatus(c) !== "proved")
    : creds.filter((c) => proofStatus(c) !== "proved");

  const {
    selectedCreds,
    atBatchLimit,
    canBatch,
    canSubmitBatch,
    selectEligible,
    clearSelection,
  } = useBatchSelection(unprovedAll, address, handleError);

  // ── Local UI state ─────────────────────────────────────────────────────────

  const [view, setView] = useState<PageView>({ kind: "list" });
  const [importing, setImporting] = useState(false);
  const [detailCred, setDetailCred] = useState<Credential | null>(null);
  const [transferCred, setTransferCred] = useState<Credential | null>(null);
  const [importPayload, setImportPayload] = useState<string | null>(null);

  // ── QR transfer import ─────────────────────────────────────────────────────

  useEffect(() => {
    const payload = searchParams.get(IMPORT_PARAM);
    if (!payload) return;
    setImportPayload(payload);
    router.replace("/holder");
  }, [searchParams, router]);

  // ── Derived data ───────────────────────────────────────────────────────────

  const displayCreds = isPreview ? PREVIEW_CREDENTIALS : creds;
  const unproved = displayCreds.filter((c) => proofStatus(c) === "unproved");
  const expiringSoon = displayCreds
    .filter((c) => proofStatus(c) === "proved" && isExpiringSoon(c, 7))
    .sort((a, b) => daysRemaining(a) - daysRemaining(b));
  const activeProved = displayCreds.filter((c) => proofStatus(c) === "proved" && !isExpiringSoon(c, 7));
  const expired = displayCreds.filter((c) => proofStatus(c) === "expired");

  // ── Sponsor-aware submission ────────────────────────────────────────────────

  const singleSubmitFn = isSponsorAvailable() ? submitSponsoredProof : submitProof;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleProveSingle = useCallback(
    (cred: Credential) => setView({ kind: "single", cred }),
    [],
  );

  const handleSingleProved = useCallback(
    (txHash: string) => {
      if (view.kind === "single") {
        markCredentialProved(view.cred.commitment, txHash);
      }
      setView({ kind: "list" });
    },
    [view, markCredentialProved],
  );

  const handleProveBatch = useCallback(
    () => setView({ kind: "batch", creds: selectedCreds }),
    [selectedCreds],
  );

  const handleBatchProved = useCallback(
    (txHash: string, commitments: string[]) => {
      markCredentialsProved(commitments, txHash);
      setView({ kind: "list" });
    },
    [markCredentialsProved],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="between" style={{ marginBottom: "2.5rem" }}>
        <div>
          <span className="eyebrow">Holder</span>
          <h1 style={{ fontSize: "2rem", marginTop: "0.35rem" }}>Your credentials</h1>
        </div>
        <div className="row" style={{ gap: "0.75rem" }}>
          {/* Selective disclosure presets (#386): a named, shareable bundle
              of several claim types — defined and shared from its own page
              rather than crowding this one, but linked from here since the
              issue asks for the entry point to live on the holder page. */}
          <a href="/presets" className="btn btn-secondary">
            Presets
          </a>
          <WalletButton />
        </div>
      </div>

      <ConfigBanner />
      <SponsorBanner />

      {isPreview && (
        <div
          style={{
            padding: "0.85rem 1rem",
            borderRadius: "var(--radius)",
            background: "rgba(62,207,142,0.1)",
            border: "1px solid rgba(62,207,142,0.3)",
            color: "var(--text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1.5rem",
          }}
        >
          <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
            Connect wallet to use your real credentials
          </span>
          <button className="btn btn-primary btn-sm" onClick={connect}>
            Connect Wallet
          </button>
        </div>
      )}

      {view.kind === "single" ? (
        <ProofFlowView
          cred={view.cred}
          holder={address}
          onBack={() => setView({ kind: "list" })}
          onProved={handleSingleProved}
          submitFn={singleSubmitFn}
        />
      ) : view.kind === "batch" ? (
        <BatchProofFlowView
          creds={view.creds}
          holder={address}
          onBack={() => setView({ kind: "list" })}
          onProved={handleBatchProved}
        />
      ) : (
        <div className="stack reveal" style={{ gap: "1.5rem" }}>
          {/* ── Expiry Warning Banner ── */}
          {(expiringSoon.length > 0 || expired.length > 0) && (
            <div
              role="status"
              aria-live="polite"
              className="card"
              style={{
                padding: "0.85rem 1.15rem",
                backgroundColor: expired.length > 0 ? "rgba(239, 68, 68, 0.08)" : "rgba(234, 179, 8, 0.08)",
                borderColor: expired.length > 0 ? "rgba(239, 68, 68, 0.3)" : "rgba(234, 179, 8, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              <div className="row" style={{ gap: "0.6rem", alignItems: "center" }}>
                <span
                  style={{
                    color: expired.length > 0 ? "var(--danger)" : "var(--warn)",
                    fontSize: "1rem",
                    flexShrink: 0,
                  }}
                >
                  ⚠
                </span>
                <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                  {expired.length > 0
                    ? `${expired.length} proof${expired.length > 1 ? "s have" : " has"} expired and ${expired.length > 1 ? "need" : "needs"} re-proving.`
                    : `${expiringSoon.length} proof${expiringSoon.length > 1 ? "s are" : " is"} expiring within 7 days.`}
                </span>
              </div>
              <span className="mono faint" style={{ fontSize: "0.75rem" }}>
                One-click re-prove available below
              </span>
            </div>
          )}

          {/* ── Empty state ── */}
          {creds.length === 0 && !importing && (
            <div className="card" style={{ textAlign: "center", padding: "3.5rem 1.5rem", borderStyle: "dashed" }}>
              <IconCertificate size={30} stroke={1.3} color="var(--faint)" />
              <h3 style={{ margin: "1rem 0 0.4rem" }}>No credentials yet</h3>
              <p className="muted" style={{ fontSize: "0.875rem", maxWidth: 340, margin: "0 auto 1.5rem" }}>
                Get a credential from a trusted issuer, then generate a zero-knowledge proof to verify it on-chain.
              </p>
              <a href="/verify" className="btn btn-primary btn-sm" style={{ display: "inline-flex" }}>
                Get a credential <IconArrowRight size={14} />
              </a>
              <p className="faint" style={{ fontSize: "0.75rem", maxWidth: 380, margin: "1.25rem auto 0", lineHeight: 1.6 }}>
                Credentials are stored only in this browser&apos;s local storage.{" "}
                <Link href="/docs#storage" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                  Where your credentials live
                </Link>
              </p>
            </div>
          )}

          {/* ── Expiring Soon (Action Recommended) ── */}
          {expiringSoon.length > 0 && (
            <div className="stack" style={{ gap: "0.6rem" }}>
              <SectionLabel>Expiring soon &middot; Re-prove recommended</SectionLabel>
              {expiringSoon.map((c) => (
                <CredCard
                  key={c.commitment}
                  c={c}
                  address={address}
                  onProve={() => handleProveSingle(c)}
                  onRemove={() => removeCred(c.commitment)}
                  onInspect={() => setDetailCred(c)}
                  isPreview={isPreview}
                />
              ))}
            </div>
          )}

          {/* ── Expired (Action Required) ── */}
          {expired.length > 0 && (
            <div className="stack" style={{ gap: "0.6rem" }}>
              <SectionLabel>Expired proofs &middot; Re-prove required</SectionLabel>
              {expired.map((c) => (
                <CredCard
                  key={c.commitment}
                  c={c}
                  address={address}
                  onProve={() => handleProveSingle(c)}
                  onRemove={() => removeCred(c.commitment)}
                  onInspect={() => setDetailCred(c)}
                  isPreview={isPreview}
                />
              ))}
            </div>
          )}

          {/* ── Credentials to prove ── */}
          {unproved.length > 0 && (
            <div className="stack" style={{ gap: "0.6rem" }}>
              <SectionLabel>Ready to prove</SectionLabel>
              {unproved.map((c) => (
                <CredCard
                  key={c.commitment}
                  c={c}
                  address={address}
                  onProve={() => handleProveSingle(c)}
                  onRemove={() => removeCred(c.commitment)}
                  isPreview={isPreview}
                />
              ))}
              {canBatch && (
                <BatchBar
                  selectedCount={selectedCreds.length}
                  atBatchLimit={atBatchLimit}
                  canSubmitBatch={canSubmitBatch}
                  onProveBatch={handleProveBatch}
                  onClear={clearSelection}
                  onSelectEligible={selectEligible}
                />
              )}
            </div>
          )}

          {/* ── Active proved ── */}
          {activeProved.length > 0 && (
            <div className="stack" style={{ gap: "0.6rem" }}>
              <SectionLabel>On-chain &middot; active proofs</SectionLabel>
              {activeProved.map((c) => (
                <CredCard
                  key={c.commitment}
                  c={c}
                  address={address}
                  onProve={() => handleProveSingle(c)}
                  onRemove={() => removeCred(c.commitment)}
                  isPreview={isPreview}
                />
              ))}
            </div>
          )}

          {!address && creds.length > 0 && (
            <p className="faint" style={{ fontSize: "0.8125rem" }}>
              Connect a wallet to generate and submit proofs.
            </p>
          )}

          {/* ── Import / Export ── */}
          {importing ? (
            <ImportPanel
              onImport={(c) => { saveCred(c); setImporting(false); }}
              onCancel={() => setImporting(false)}
            />
          ) : (
            <div className="stack" style={{ gap: "0.55rem" }}>
              <div className="row" style={{ gap: "0.6rem", flexWrap: "wrap" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setImporting(true)}>
                  <IconPlus size={14} /> Import credential JSON
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={downloadBackup}
                  disabled={creds.length === 0}
                  title={creds.length === 0 ? "No credentials to back up" : "Download a JSON backup"}
                >
                  <IconDownload size={14} /> Export backup
                </button>
              </div>
              <p className="faint" style={{ fontSize: "0.75rem", maxWidth: 560, lineHeight: 1.6, margin: 0 }}>
                Credentials live only in this browser (localStorage). Export a backup before clearing site data.{" "}
                <Link href="/docs#storage" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                  Where your credentials live
                </Link>
              </p>
            </div>
          )}
        </div>
      )}

      {detailCred && (
        <CredentialDetailModal
          credential={detailCred as any}
          onClose={() => setDetailCred(null)}
          onTransfer={(c) => { setDetailCred(null); setTransferCred(c as Credential); }}
        />
      )}
      {transferCred && <TransferExportModal cred={transferCred} onClose={() => setTransferCred(null)} />}
      {importPayload && (
        <TransferImportModal
          payload={importPayload}
          onImported={(c) => { saveCred(c); setImportPayload(null); toast.success(`Imported ${c.title}`); }}
          onClose={() => setImportPayload(null)}
        />
      )}
    </>
  );
}

export default function HolderPage() {
  return <Suspense fallback={null}><HolderInner /></Suspense>;
}
  return (
    <Suspense fallback={null}>
      <HolderInner />
    </Suspense>
  );
}

// ── Import panel ──────────────────────────────────────────────────────────────

function ImportPanel({ onImport, onCancel }: { onImport: (c: Credential) => void; onCancel: () => void }) {
  const [json, setJson] = useState("");
  const [error, setError] = useState("");

  function onAdd() {
    try { onImport(parseCredential(json)); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="card reveal">
      <span className="eyebrow">Import credential</span>
      <textarea
        rows={5}
        placeholder='{"type":"kyc","commitment":"0x…", …}'
        value={json}
        onChange={(e) => setJson(e.target.value)}
        style={{ marginTop: "0.75rem" }}
      />
      {error && <p style={{ color: "var(--danger)", fontSize: "0.8125rem", marginTop: "0.5rem" }}>{error}</p>}
      <div className="row" style={{ marginTop: "1rem", gap: "0.6rem" }}>
        <button className="btn btn-primary btn-sm" onClick={onAdd} disabled={!json.trim()}>Add credential</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// --- progress types + small ProofProgress component ---

type StepStatus = "pending" | "active" | "done" | "error";

type ProgressStep = {
  label: string;
  status: StepStatus;
  error?: string;
};

function ProofProgress({ steps }: { steps: ProgressStep[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      {steps.map((s, idx) => {
        const isLast = idx === steps.length - 1;
        return (
          <div key={s.label} style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 28, flexShrink: 0 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  border: `1px solid ${
                    s.status === "done" ? "var(--accent)" :
                    s.status === "active" ? "rgba(62,207,142,0.5)" :
                    "var(--border-strong)"
                  }`,
                  background: s.status === "done" ? "var(--accent)" : "transparent",
                  color: s.status === "done" ? "var(--bg)" : s.status === "active" ? "var(--accent)" : "var(--faint)",
                  transition: "all 0.25s var(--ease)",
                }}
              >
                {s.status === "done" ? (
                  <IconCheck size={13} stroke={3} />
                ) : s.status === "active" ? (
                  <IconLoader2 size={13} className="spin" />
                ) : s.status === "error" ? (
                  <IconAlertTriangle size={13} />
                ) : (
                  <span style={{ fontSize: "0.7rem", color: "var(--faint)" }}>•</span>
                )}
              </div>

              {!isLast && (
                <div
                  style={{
                    width: 1,
                    flex: 1,
                    minHeight: 20,
                    marginTop: 6,
                    background: s.status === "done" ? "var(--accent)" : "var(--border)",
                    opacity: s.status === "done" ? 0.4 : 1,
                    transition: "background 0.3s var(--ease)",
                  }}
                />
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "0.25rem" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem", color: s.status === "pending" ? "var(--muted)" : "var(--text)" }}>
                  {s.label}
                </span>
                {s.status === "active" && (
                  <span
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--accent)",
                      background: "rgba(62,207,142,0.1)",
                      border: "1px solid rgba(62,207,142,0.2)",
                      borderRadius: 999,
                      padding: "0.12rem 0.45rem",
                      fontWeight: 500,
                    }}
                  >
                    running
                  </span>
                )}
              </div>
              {s.error && (
                <div style={{ marginTop: "0.45rem", color: "var(--danger)", fontSize: "0.82rem" }}>
                  {s.error}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── ProofFlow ─────────────────────────────────────────────────────────────────

const ESTIMATES: Record<string, { range: string; expected: number; max: number }> = {
  default: { range: "~10–20 seconds", expected: 15, max: 20 },
};

type Stage =
  | "witness"
  | "circuit"
  | "proof"
  | "proving"
  | "generated"
  | "preflight"
  | "readyToSign"
  | "submitting"
  | "confirmed"
  | "error";

function ProofFlow({
  cred,
  holder,
  onBack,
  onProved,
}: {
  cred: Credential;
  holder: string;
  onBack: () => void;
  onProved: (txHash: string) => void;
}) {
  const { networkMismatch } = useWallet();
  const [stage, setStage] = useState<Stage>("witness");
  const [proof, setProof] = useState<{ proof: Uint8Array; publicInputs: Uint8Array } | null>(null);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState<ContractError | null>(null);
  const [errorPhase, setErrorPhase] = useState<
    "proving" | "preflight" | "submitting" | "timeout" | null
  >(null);
  /** Estimated on-chain fee reported by the preflight simulation. */
  const [fee, setFee] = useState<FeeEstimate | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const { addEvent } = useProofTimeline(cred);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    toast.info(`Generating proof for ${cred.title}…`);
    (async () => {
      try {
        const start = Date.now();
        timerRef.current = setInterval(
          () => setElapsed(Math.floor((Date.now() - start) / 1000)),
          1000,
        );
        // Stage 1: witness (server) — wrapped with a deadline so a stalled
        // prover fails visibly instead of spinning forever.
        setStage("witness");
        const witness = await withTimeout(
          (sig) =>
            computeWitness(
              cred.type,
              cred as unknown as Record<string, unknown>,
              sig,
            ),
          { signal, timeoutMs: DEFAULT_PROOF_TIMEOUT_MS },
        );
        if (signal.aborted) return;

        // Stage 2: prove (browser WASM)
        setStage("proving");
        const proveStart = Date.now();
        timerRef.current = setInterval(
          () => setElapsed(Math.floor((Date.now() - proveStart) / 1000)),
          1000,
        );

        const result = await withTimeout(
          (sig) =>
            proveWithBackend(cred.type, witness, sig, (step) => {
              if (!sig.aborted) setStage(step);
            }),
          { signal, timeoutMs: DEFAULT_PROOF_TIMEOUT_MS },
        );
        if (signal.aborted) return;

        setProof(result);
        setStage("generated");
        addEvent("generated");
        toast.success(`Proof generated for ${cred.title}`);
      } catch (e) {
        if (signal.aborted) return;
        // ProofTimeoutError gets a distinct user-visible message — half the
        // point is that stalled provers fail visibly, not as a generic error.
        if (e instanceof ProofTimeoutError) {
          setError({
            code: null,
            friendly:
              "Proof generation timed out. The prover took too long — this can happen on slow devices or with large circuits. Please try again.",
            raw: e.message,
          });
          setErrorPhase("timeout");
          setStage("error");
          toast.error("Proof timed out — please try again.");
          return;
        }
        const parsed = parseContractError((e as Error).message);
        setError(parsed);
        setErrorPhase("proving");
        setStage("error");
        toast.error(`Proof generation failed: ${parsed.friendly}`);
      } finally {
        // Always clean up: timer + abort controller. The finally-style
        // pattern guarantees no early-return can leak a pending timeout
        // or interval.
        clearInterval(timerRef.current!);
      }
    })();
    return () => {
      controller.abort();
      clearInterval(timerRef.current!);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cred]);
  useEffect(() => {
    switch (stage) {
      case "generated":
        submitButtonRef.current?.focus();
        break;

      case "confirmed":
        successRef.current?.focus();
        break;

      case "error":
        errorRef.current?.focus();
        break;
    }
  }, [stage]);
  /**
   * First click on "Submit to Stellar": run a Soroban preflight simulation so
   * a doomed submission is caught (and its human reason shown) and the fee is
   * surfaced BEFORE the wallet signature is requested.
   */
  async function onSubmit() {
    if (!proof || networkMismatch) return;
    setError(null);
    setErrorPhase(null);
    setFee(null);
    setStage("preflight");
    addEvent("preflight");
    try {
      const preflight = await preflightSubmitProof({
        holder,
        issuerId: cred.issuerId,
        credentialType: cred.type,
        proof: proof.proof,
        publicInputs: proof.publicInputs,
        ttlSecs: credTtlSecs(cred),
      });
      if (!preflight.ok) {
        // Simulation says the transaction would revert — surface the mapped
        // reason and do NOT request a signature (an override is offered).
        setError(preflight.error);
        setErrorPhase("preflight");
        setStage("error");
        toast.error(`Submission blocked — ${preflight.error.friendly}`);
        return;
      }
      setFee(preflight.fee);
      setStage("readyToSign");
    } catch (e) {
      // RPC/tooling failure during the simulation. Treat it like a preflight
      // blocker (an override lets the user proceed), so we never sign blind.
      const parsed = parseContractError((e as Error).message);
      setError(parsed);
      setErrorPhase("preflight");
      setStage("error");
      toast.error(`Preflight simulation failed: ${parsed.friendly}`);
    }
  }

  /**
   * Sign and send the proof-bearing transaction. Only reached after the
   * preflight simulation succeeded (or the user chose to override a failed one)
   * — this is the point where the wallet signature is actually requested.
   */
  async function doSignAndSubmit() {
    if (!proof || networkMismatch) return;
    setStage("submitting");
    addEvent("submitted");
    toast.info(`Submitting proof for ${cred.title} to Stellar…`);
    try {
      const hash = await submitProof({
        holder,
        issuerId: cred.issuerId,
        credentialType: cred.type,
        proof: proof.proof,
        publicInputs: proof.publicInputs,
        ttlSecs: credTtlSecs(cred),
      });
      setTxHash(hash);
      onProved(hash);
      setStage("confirmed");
      addEvent("verified", { txHash: hash });
      toast.success(`Proof confirmed on-chain for ${cred.title}`, { txHash: hash });
    } catch (e) {
      const parsed = parseContractError((e as Error).message);
      setError(parsed);
      setErrorPhase("submitting");
      setStage("error");
      toast.error(`Submission failed: ${parsed.friendly}`);
    }
  }

  // Re-submit an already-generated proof without re-proving. The proof has
  // already passed a simulation, so skip straight to signing; a retry after a
  // submit-phase failure doesn't need another preflight round-trip.
  async function onRetrySubmit() {
    if (!proof) return;
    setError(null);
    setErrorPhase(null);
    if (fee) setStage("readyToSign");
    await doSignAndSubmit();
  }

  const proofDone =
    stage === "generated" ||
    stage === "preflight" ||
    stage === "readyToSign" ||
    stage === "submitting" ||
    stage === "confirmed";
  const submitDone = stage === "confirmed";

  return (
    <div className="reveal" style={{ maxWidth: 520, margin: "0 auto" }}>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        <IconArrowLeft size={14} />
        All credentials
      </button>

      <div className="card" style={{ padding: "1.75rem" }}>
        {/* credential header */}
        <div style={{ marginBottom: "1.5rem" }}>
          <span className="eyebrow" style={{ marginBottom: "0.5rem", display: "block" }}>
            Proving
          </span>
          <h2 style={{ marginBottom: "0.25rem" }}>{cred.title}</h2>
          <span className="mono faint" style={{ fontSize: "0.8rem" }}>{cred.claim}</span>
        </div>

        {/* step list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          <style>{`
            .mobile-only-note { display: none; }
            @media (max-width: 600px) { .mobile-only-note { display: block; } }
          `}</style>
          <ProofStep
            icon={<IconCpu size={14} stroke={1.8} />}
            title="Generate zero-knowledge proof"
            subtitle={`Estimated time: ${ESTIMATES.default.range}`}
            state={
              (stage === "witness" || stage === "proving" || stage === "circuit" || stage === "proof") ? "active" :
              proofDone            ? "done"   : "idle"
            }
            detail={
              (stage === "witness" || stage === "proving" || stage === "circuit" || stage === "proof") ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.65rem" }}>
                  <ProvingBar progress={Math.min((elapsed / ESTIMATES.default.expected) * 80, 80)} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      {elapsed > ESTIMATES.default.max * 1.5 ? "Taking a bit longer than usual…" :
                       stage === "witness" ? "Generating witness…" :
                       elapsed < 2 ? "Loading circuit…" : "Proving…"}
                    </span>
                    <span className="mono" style={{ fontSize: "0.72rem", color: "var(--faint)" }}>
                      {elapsed} s elapsed
                    </span>
                  </div>
                  <div style={{ margin: "0.5rem 0" }}>
                    <ProofProgress steps={[
                      {
                        label: "Load circuit WASM",
                        status: stage === "circuit" ? "active" : (stage === "proof" || proofDone) ? "done" : "pending",
                      },
                      {
                        label: "Generate ultraplonk proof",
                        status: stage === "proof" ? "active" : proofDone ? "done" : "pending",
                      }
                    ]} />
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "var(--faint)" }}>
                    First run loads the WASM prover (~5–15 s)
                  </span>
                </div>
              ) : proofDone && proof ? (
                <div style={{ marginTop: "0.4rem" }}>
                  <span className="mono" style={{ fontSize: "0.75rem", color: "var(--accent)" }}>
                    π {truncateHash("0x" + toHex(proof.proof))}
                  </span>
                  <span className="mono faint" style={{ fontSize: "0.72rem", marginLeft: "0.5rem" }}>
                    {proof.proof.length.toLocaleString()} bytes
                  </span>
                </div>
              ) : null
            }
          />

          <ProofStep
            icon={<IconCloudUpload size={14} stroke={1.8} />}
            title="Submit to Stellar"
            subtitle="ProofRegistry.submit_proof · wallet signature"
            state={
              stage === "preflight" || stage === "readyToSign" || stage === "submitting"
                ? "active"
                : submitDone
                  ? "done"
                  : "idle"
            }
            last
            detail={
              stage === "preflight" ? (
                <AnimatedDots text="Running preflight simulation" style={{ marginTop: "0.35rem" }} />
              ) : stage === "readyToSign" ? (
                <div
                  className="row"
                  style={{ gap: "0.5rem", marginTop: "0.35rem", alignItems: "center", flexWrap: "wrap" }}
                >
                  <span style={{ fontSize: "0.75rem", color: "var(--accent)", fontWeight: 500 }}>
                    Estimated fee: {fee?.display ?? "—"}
                  </span>
                  <span className="faint" style={{ fontSize: "0.72rem" }}>
                    Simulation passed — ready to sign
                  </span>
                </div>
              ) : stage === "submitting" ? (
                <AnimatedDots text="Writing to ProofRegistry" style={{ marginTop: "0.35rem" }} />
              ) : submitDone ? (
                <div
                  className="row"
                  style={{ gap: "0.5rem", marginTop: "0.3rem", alignItems: "center" }}
                >
                  <a
                    href={EXPLORER_TX(txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="row accent"
                    style={{ gap: "0.3rem", fontSize: "0.775rem" }}
                  >
                    {txHash.slice(0, 8)}...{txHash.slice(-6)}
                    <IconExternalLink size={12} />
                  </a>
                  <CopyButton value={txHash} />
                </div>
              ) : null
            }
          />
        </div>

        {/* CTA */}
        {(stage === "generated" || stage === "preflight" || stage === "readyToSign") && (
          <>
            {networkMismatch && (
              <div style={{ marginTop: "1.5rem" }}>
                <NetworkMismatchBanner />
              </div>
            )}
            {stage === "preflight" ? (
              <button
                className="btn btn-primary"
                style={{ marginTop: networkMismatch ? 0 : "1.5rem", width: "100%", opacity: 0.7, cursor: "progress" }}
                disabled
              >
                <IconLoader2 size={15} className="spin" /> Running preflight simulation…
              </button>
            ) : stage === "readyToSign" ? (
              <button
                className="btn btn-primary"
                ref={submitButtonRef}
                style={
                  {
                    marginTop: networkMismatch ? 0 : "1.5rem",
                    width: "100%",
                    opacity: networkMismatch ? 0.5 : 1,
                    cursor: networkMismatch ? "not-allowed" : "pointer",
                  }
                }
                onClick={doSignAndSubmit}
                disabled={networkMismatch || !proofSubmissionConfigured()}
                title={
                  networkMismatch
                    ? "Switch your wallet to the correct network to submit"
                    : !proofSubmissionConfigured()
                      ? "App not configured — NEXT_PUBLIC_PROOF_REGISTRY_ID missing"
                      : undefined
                }
              >
                Sign & submit{fee ? ` (${fee.display})` : ""}
                <IconArrowRight size={15} />
              </button>
            ) : (
              <button
                className="btn btn-primary"
                ref={submitButtonRef}
                style={
                  {
                    marginTop: networkMismatch ? 0 : "1.5rem",
                    width: "100%",
                    opacity: networkMismatch ? 0.5 : 1,
                    cursor: networkMismatch ? "not-allowed" : "pointer",
                  }
                }
                onClick={onSubmit}
                disabled={networkMismatch || !proofSubmissionConfigured()}
                title={
                  networkMismatch
                    ? "Switch your wallet to the correct network to submit"
                    : !proofSubmissionConfigured()
                      ? "App not configured — NEXT_PUBLIC_PROOF_REGISTRY_ID missing"
                      : undefined
                }
              >
                Submit to Stellar
                <IconArrowRight size={15} />
              </button>
            )}
          </>
        )}

        {error && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            style={{
              marginTop: "1.5rem",
              padding: "0.9rem 1.1rem",
              borderRadius: "var(--radius)",
              border: "1px solid rgba(240,96,77,0.3)",
              background: "rgba(240,96,77,0.06)",
            }}
          >
            <div className="row" style={{ gap: "0.5rem", color: "var(--danger)", fontWeight: 600, fontSize: "0.875rem" }}>
              <IconAlertTriangle size={15} />
              {errorPhase === "timeout"
                ? "Proof timed out"
                : errorPhase === "proving"
                  ? "Proof generation failed"
                  : errorPhase === "preflight"
                    ? "Submission blocked before signing"
                    : errorPhase === "submitting"
                      ? "Submission failed — proof is ready to retry"
                      : error.code !== null ? `Contract error #${error.code}` : "Could not complete"}
            </div>
            {error.raw !== error.friendly && (
              <div style={{ marginTop: "0.6rem" }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowRaw((v) => !v)}
                  style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem", color: "var(--faint)" }}
                >
                  {showRaw ? "Hide" : "Show"} raw error
                </button>
                {showRaw && (
                  <pre
                    className="mono"
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.68rem",
                      color: "var(--faint)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      lineHeight: 1.5,
                      maxHeight: 180,
                      overflowY: "auto",
                      background: "rgba(0,0,0,0.2)",
                      padding: "0.6rem",
                      borderRadius: "calc(var(--radius) - 2px)",
                    }}
                  >
                    {error.raw}
                  </pre>
                )}
              </div>
            )}
            {/* A preflight simulation predicted the submit would fail. The
                proof is generated and intact, so offer an explicit override to
                sign & submit anyway (the user may know something the sim
                doesn't, e.g. the chain state changing). */}
            {errorPhase === "preflight" && proof && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: "1rem", width: "100%" }}
                onClick={doSignAndSubmit}
              >
                Sign & submit anyway
                <IconArrowRight size={15} />
              </button>
            )}
            {/* Retry submission without re-proving when the proof exists */}
            {errorPhase === "submitting" && proof && (
              <button
                className="btn btn-primary"
                style={{ marginTop: "1rem", width: "100%" }}
                onClick={onRetrySubmit}
              >
                Retry submission
                <IconArrowRight size={15} />
              </button>
            )}
          </div>
        )}

        {stage === "confirmed" && (
          <div
            ref={successRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className="reveal"
            style={{
              marginTop: "1.5rem",
              padding: "1.25rem",
              borderRadius: "var(--radius)",
              background: "rgba(62,207,142,0.07)",
              border: "1px solid rgba(62,207,142,0.2)",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
            }}
          >
            <Check size={44} run />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>Proof verified on-chain</div>
              <div className="muted" style={{ fontSize: "0.8375rem", marginTop: "0.25rem", lineHeight: 1.5 }}>
                Your claim is live on Stellar for {Math.round(credTtlSecs(cred) / 86_400)} days — without revealing the data behind it.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── BatchProofFlow ────────────────────────────────────────────────────────────

/** State of one credential's local proving steps. */
type CredProofState =
  | { status: "pending" }
  | { status: "witness" }
  | { status: "proving"; elapsed: number }
  | { status: "ready"; proof: { proof: Uint8Array; publicInputs: Uint8Array } }
  | { status: "error"; message: string };

type BatchStage = "generating" | "submitting" | "confirmed" | "error";

function BatchProofFlow({
  creds,
  holder,
  onBack,
  onProved,
}: {
  creds: Credential[];
  holder: string;
  onBack: () => void;
  onProved: (txHash: string, commitments: string[]) => void;
}) {
  const [credStates, setCredStates] = useState<CredProofState[]>(
    () => creds.map(() => ({ status: "pending" as const })),
  );
  const [batchStage, setBatchStage] = useState<BatchStage>("generating");
  const [txHash, setTxHash] = useState("");
  const [batchError, setBatchError] = useState<ContractError | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  /** Estimated fee reported by the batch preflight simulation. */
  const [batchFee, setBatchFee] = useState<FeeEstimate | null>(null);
  const toast = useToast();
  const { networkMismatch } = useWallet();
  const generatedProofs = useRef<Array<{ proof: Uint8Array; publicInputs: Uint8Array } | null>>(
    creds.map(() => null),
  );
  // Stable refs so the submission effect always reads the latest values
  // even if the parent re-renders between proof generation and submission.
  const credsRef = useRef(creds);
  const holderRef = useRef(holder);
   const networkMismatchRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { credsRef.current = creds; }, [creds]);
  useEffect(() => { holderRef.current = holder; }, [holder]);

  // Generate proofs for all credentials in sequence.
  useEffect(() => {
    let cancelled = false;
    toast.info(`Generating ${creds.length} proofs…`);

    (async () => {
      for (let i = 0; i < creds.length; i++) {
        if (cancelled) return;
        const cred = creds[i];

        // Witness
        setCredStates((prev) => {
          const next = [...prev];
          next[i] = { status: "witness" };
          return next;
        });

        let witness: Uint8Array;
        try {
          witness = await computeWitness(cred.type, cred as unknown as Record<string, unknown>);
        } catch (e) {
          if (cancelled) return;
          setCredStates((prev) => {
            const next = [...prev];
            next[i] = { status: "error", message: (e as Error).message };
            return next;
          });
          setBatchStage("error");
          const parsed = parseContractError((e as Error).message);
          setBatchError(parsed);
          toast.error(`Proof generation failed for ${cred.title}: ${parsed.friendly}`);
          return;
        }

        if (cancelled) return;

        // Proving
        const start = Date.now();
        const timer = setInterval(() => {
          setCredStates((prev) => {
            const next = [...prev];
            if (next[i].status === "proving") {
              next[i] = { status: "proving", elapsed: Math.floor((Date.now() - start) / 1000) };
            }
            return next;
          });
        }, 1000);
        setCredStates((prev) => {
          const next = [...prev];
          next[i] = { status: "proving", elapsed: 0 };
          return next;
        });

        let result: { proof: Uint8Array; publicInputs: Uint8Array };
        try {
          result = await proveWithBackend(cred.type, witness);
        } catch (e) {
          clearInterval(timer);
          if (cancelled) return;
          setCredStates((prev) => {
            const next = [...prev];
            next[i] = { status: "error", message: (e as Error).message };
            return next;
          });
          setBatchStage("error");
          const parsed = parseContractError((e as Error).message);
          setBatchError(parsed);
          toast.error(`Proof generation failed for ${cred.title}: ${parsed.friendly}`);
          return;
        }

        clearInterval(timer);
        if (cancelled) return;

        generatedProofs.current[i] = result;
        setCredStates((prev) => {
          const next = [...prev];
          next[i] = { status: "ready", proof: result };
          return next;
        });
        addTimelineEvent(cred.commitment, "generated");
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // All proofs ready — fire the batch submission automatically, but never
  // while the connected wallet is on the wrong network: submission would
  // fail after the (expensive) proofs are already generated. Once ready,
  // this effect re-fires the moment `networkMismatch` clears — no separate
  // retry button needed, matching this flow's fully-automatic submission.
  const allReady =
    batchStage === "generating" &&
    credStates.length > 0 &&
    credStates.every((s) => s.status === "ready");
  const blockedByNetwork = allReady && networkMismatch;

  useEffect(() => {
    if (!allReady || networkMismatch) return;
    // Defensive: entry buttons are already gated, but never auto-fire an
    // on-chain submission on a misconfigured deploy either.
    if (!proofSubmissionConfigured()) return;
    toast.success(`Generated ${creds.length} proofs`);
    setBatchStage("submitting");

    const currentCreds = credsRef.current;
    const currentHolder = holderRef.current;
    const submissions: ProofSubmissionParams[] = currentCreds.map((cred, i) => {
      const p = generatedProofs.current[i]!;
      return {
        issuerId: cred.issuerId,
        credentialType: cred.type,
        proof: p.proof,
        publicInputs: p.publicInputs,
        ttlSecs: credTtlSecs(cred),
      };
    });

    currentCreds.forEach(cred => addTimelineEvent(cred.commitment, "submitted"));

    setBatchFee(null);
    toast.info(`Simulating batch of ${currentCreds.length} proofs…`);
    (async () => {
      // Stage 1 — preflight simulation: catch a doomed batch (invalid proof,
      // duplicate type, untrusted issuer, paused submissions, …) and surface
      // its mapped reason BEFORE a single Frieght/wallet signature is spent.
      const preflight = await preflightSubmitProofs({ holder: currentHolder, submissions });
      if (!preflight.ok) {
        setBatchError(preflight.error);
        setBatchStage("error");
        toast.error(`Batch submission blocked — ${preflight.error.friendly}`);
        return;
      }
      setBatchFee(preflight.fee);

      // Stage 2 — the simulation succeeded, so it's safe to request the
      // signature and submit.
      let hash: string;
      try {
        hash = await submitProofs({ holder: currentHolder, submissions });
      } catch (e) {
        const parsed = parseContractError((e as Error).message);
        setBatchError(parsed);
        setBatchStage("error");
        toast.error(`Batch submission failed: ${parsed.friendly}`);
        return;
      }
      setTxHash(hash);
      const commitments = currentCreds.map((c) => c.commitment);
      onProved(hash, commitments);
      setBatchStage("confirmed");

      currentCreds.forEach(cred => addTimelineEvent(cred.commitment, "verified", { txHash: hash }));

      toast.success(`Confirmed ${creds.length} proofs on-chain`, { txHash: hash });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady, networkMismatch, onProved]);

  const isSubmitting = batchStage === "submitting";
  const isConfirmed = batchStage === "confirmed";
  const isError = batchStage === "error";

  useEffect(() => {
  if (blockedByNetwork) {
    networkMismatchRef.current?.focus();
    return;
  }

  switch (batchStage) {
    case "confirmed":
      successRef.current?.focus();
      break;

    case "error":
      errorRef.current?.focus();
      break;
  }
  }, [blockedByNetwork, batchStage]);
  return (
    <div className="reveal" style={{ maxWidth: 560, margin: "0 auto" }}>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        <IconArrowLeft size={14} />
        All credentials
      </button>

      <div className="card" style={{ padding: "1.75rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <span className="eyebrow" style={{ marginBottom: "0.5rem", display: "block" }}>
            Batch proving
          </span>
          <h2 style={{ marginBottom: "0.25rem" }}>
            Prove all {creds.length} credentials
          </h2>
          <span className="faint" style={{ fontSize: "0.8rem" }}>
            Proofs are generated in your browser, then submitted in a single on-chain transaction.
          </span>
        </div>

        {/* Per-credential progress rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {creds.map((cred, i) => {
            const cs = credStates[i] ?? { status: "pending" };
            return (
              <BatchCredRow
                key={cred.commitment}
                cred={cred}
                state={cs}
                isLast={i === creds.length - 1}
              />
            );
          })}
        </div>

        {/* Submission step */}
        <ProofStep
          icon={<IconCloudUpload size={14} stroke={1.8} />}
          title="Submit batch to Stellar"
          subtitle={`ProofRegistry.submit_proofs · ${creds.length} credentials · single Freighter signature`}
          state={
            isSubmitting ? "active" :
            isConfirmed  ? "done"   : "idle"
          }
          last
          detail={
            isSubmitting ? (
              <div style={{ marginTop: "0.35rem" }}>
                <AnimatedDots
                  text={batchFee ? "Writing all proofs to ProofRegistry" : "Running preflight simulation"}
                />
                {batchFee && (
                  <span style={{ fontSize: "0.72rem", color: "var(--accent)", marginLeft: "0.5rem", fontWeight: 500 }}>
                    Estimate · {batchFee.display}
                  </span>
                )}
              </div>
            ) : isConfirmed ? (
              <div
                className="row"
                style={{ gap: "0.5rem", marginTop: "0.3rem", alignItems: "center" }}
              >
                <a
                  href={EXPLORER_TX(txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="row accent"
                  style={{ gap: "0.3rem", fontSize: "0.775rem" }}
                >
                  {txHash.slice(0, 8)}...{txHash.slice(-6)}
                  <IconExternalLink size={12} />
                </a>
                <CopyButton value={txHash} />
              </div>
            ) : null
          }
        />

        {/* Network mismatch — proofs are ready but submission is blocked */}
        {blockedByNetwork && (
          <div  ref={networkMismatchRef} tabIndex={-1} role="status" style={{ marginTop: "1.5rem" }}>
            <NetworkMismatchBanner />
          </div>
        )}

        {/* Error banner */}
        {isError && batchError && (
          <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"  
          style={{
              marginTop: "1.5rem",
              padding: "0.9rem 1.1rem",
              borderRadius: "var(--radius)",
              border: "1px solid rgba(240,96,77,0.3)",
              background: "rgba(240,96,77,0.06)",
            }}
          >
            <div className="row" style={{ gap: "0.5rem", color: "var(--danger)", fontWeight: 600, fontSize: "0.875rem" }}>
              <IconAlertTriangle size={15} />
              {batchError.code !== null ? `Contract error #${batchError.code}` : "Batch failed"}
            </div>
            <div style={{ fontSize: "0.8125rem", marginTop: "0.45rem", lineHeight: 1.65, color: "var(--text)" }}>
              {batchError.friendly}
            </div>
            {batchError.raw !== batchError.friendly && (
              <div style={{ marginTop: "0.6rem" }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowRaw((v) => !v)}
                  style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem", color: "var(--faint)" }}
                >
                  {showRaw ? "Hide" : "Show"} raw error
                </button>
                {showRaw && (
                  <pre
                    className="mono"
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.68rem",
                      color: "var(--faint)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      lineHeight: 1.5,
                      maxHeight: 180,
                      overflowY: "auto",
                      background: "rgba(0,0,0,0.2)",
                      padding: "0.6rem",
                      borderRadius: "calc(var(--radius) - 2px)",
                    }}
                  >
                    {batchError.raw}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* Confirmed success banner */}
        {isConfirmed && (
          <div
            className="reveal"
            ref={successRef}
            tabIndex={-1}
            role="status"
            style={{
              marginTop: "1.5rem",
              padding: "1.25rem",
              borderRadius: "var(--radius)",
              background: "rgba(62,207,142,0.07)",
              border: "1px solid rgba(62,207,142,0.2)",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
            }}
          >
            <Check size={44} run />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>
                All {creds.length} proofs verified on-chain
              </div>
              <div className="muted" style={{ fontSize: "0.8375rem", marginTop: "0.25rem", lineHeight: 1.5 }}>
                Every credential is now live on Stellar — submitted in a single transaction.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── BatchCredRow ──────────────────────────────────────────────────────────────

function BatchCredRow({
  cred,
  state,
  isLast,
}: {
  cred: Credential;
  state: CredProofState;
  isLast: boolean;
}) {
  const isPending = state.status === "pending";
  const isWitness = state.status === "witness";
  const isProving = state.status === "proving";
  const isReady   = state.status === "ready";
  const isErr     = state.status === "error";

  const stepState: "idle" | "active" | "done" =
    isReady ? "done" :
    isProving || isWitness ? "active" :
    isErr ? "idle" :
    "idle";

  const detail = isWitness ? (
    <AnimatedDots text="Computing witness" style={{ marginTop: "0.25rem" }} />
  ) : isProving ? (
    <div style={{ marginTop: "0.35rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <ProvingBar progress={Math.min((((state as { status: "proving"; elapsed: number }).elapsed) / ESTIMATES.default.expected) * 80, 80)} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
          {((state as { status: "proving"; elapsed: number }).elapsed) > ESTIMATES.default.max * 1.5 ? "Taking a bit longer than usual…" : "Generating proof in browser…"}
        </span>
        <span className="mono" style={{ fontSize: "0.7rem", color: "var(--faint)" }}>
          {(state as { status: "proving"; elapsed: number }).elapsed}s
        </span>
      </div>
    </div>
  ) : isReady ? (
    <div style={{ marginTop: "0.2rem" }}>
      <span className="mono" style={{ fontSize: "0.72rem", color: "var(--accent)" }}>
        π {truncateHash("0x" + toHex((state as { status: "ready"; proof: { proof: Uint8Array; publicInputs: Uint8Array } }).proof.proof))}
      </span>
      <span className="mono faint" style={{ fontSize: "0.7rem", marginLeft: "0.4rem" }}>
        {(state as { status: "ready"; proof: { proof: Uint8Array; publicInputs: Uint8Array } }).proof.proof.length.toLocaleString()} bytes
      </span>
    </div>
  ) : isErr ? (
    <span style={{ fontSize: "0.72rem", color: "var(--danger)", marginTop: "0.2rem", display: "block" }}>
      {(state as { status: "error"; message: string }).message.slice(0, 80)}
    </span>
  ) : null;

  const icon =
    isPending ? <span style={{ fontSize: "0.65rem", color: "var(--faint)" }}>{cred.type.slice(0, 3)}</span> :
    isErr     ? <IconAlertTriangle size={13} /> :
                <IconCpu size={13} stroke={1.8} />;

  return (
    <ProofStep
      icon={icon}
      title={cred.title}
      subtitle={cred.claim}
      state={stepState}
      detail={detail}
      last={isLast}
    />
  );
}

// ── ProofStep ─────────────────────────────────────────────────────────────────

function ProofStep({
  icon,
  title,
  subtitle,
  state,
  detail,
  last = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  state: "idle" | "active" | "done";
  detail?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start" }}>
      {/* left: connector */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 28, flexShrink: 0 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            border: `1px solid ${
              state === "done"   ? "var(--accent)" :
              state === "active" ? "rgba(62,207,142,0.5)" :
                                   "var(--border-strong)"
            }`,
            background: state === "done" ? "var(--accent)" : "transparent",
            color: state === "done" ? "var(--bg)" : state === "active" ? "var(--accent)" : "var(--faint)",
            transition: "all 0.35s var(--ease)",
          }}
        >
          {state === "done" ? (
            <IconCheck size={13} stroke={3} />
          ) : state === "active" ? (
            <IconLoader2 size={13} className="spin" />
          ) : (
            icon
          )}
        </div>
        {!last && (
          <div
            style={{
              width: 1,
              flex: 1,
              minHeight: 20,
              marginTop: 4,
              background: state === "done" ? "var(--accent)" : "var(--border)",
              transition: "background 0.4s var(--ease)",
              opacity: state === "done" ? 0.4 : 1,
            }}
          />
        )}
      </div>

      {/* right: text */}
      <div style={{ paddingBottom: last ? 0 : "1.25rem", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "0.3rem" }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: "0.875rem",
              color: state === "idle" ? "var(--muted)" : "var(--text)",
              transition: "color 0.25s var(--ease)",
            }}
          >
            {title}
          </span>
          {state === "active" && (
            <span
              style={{
                fontSize: "0.68rem",
                color: "var(--accent)",
                background: "rgba(62,207,142,0.1)",
                border: "1px solid rgba(62,207,142,0.2)",
                borderRadius: "999px",
                padding: "0.1rem 0.45rem",
                fontWeight: 500,
              }}
            >
              running
            </span>
          )}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--faint)", marginTop: "0.1rem" }}>
          {subtitle}
        </div>
        {detail}
      </div>
    </div>
  );
}

// ── Small utilities ───────────────────────────────────────────────────────────

function AnimatedDots({ text, style }: { text: string; style?: React.CSSProperties }) {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const id = setInterval(() => setDots((d) => d.length >= 3 ? "." : d + "."), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontSize: "0.8rem", color: "var(--muted)", ...style }}>
      {text}
      <span style={{ color: "var(--accent)" }}>{dots}</span>
    </span>
  );
}

function ProvingBar({ progress = 0 }: { progress?: number }) {
  return (
    <div
      style={{
        height: "4px",
        borderRadius: "999px",
        background: "var(--bg-soft)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          background: "var(--accent)",
          width: `${progress}%`,
          transition: "width 1s linear",
        }}
      />
    </div>
  );
}

function toHex(u8: Uint8Array): string {
  return Array.from(u8.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
