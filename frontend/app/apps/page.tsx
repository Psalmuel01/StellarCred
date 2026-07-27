"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { IconCheck, IconCircle, IconSearch, IconFilter } from "@tabler/icons-react";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/lib/wallet-context";
import { Badge } from "@/components/Badge";
import { ConfigBanner } from "@/components/ConfigBanner";
import { usePreviewMode } from "@/lib/wallet-context";
import { checkClaim } from "@/lib/contracts";
import { PROTOCOLS, type Protocol } from "@/lib/protocols";
import { CREDENTIAL_TYPES } from "@/lib/stellar";
import { QRCodeCanvas } from "qrcode.react";
import { encryptPayload } from "@/lib/cryptos";

const CLAIM_LABELS: Record<string, string> = {
  kyc: "KYC",
  age: "Age",
  jurisdiction: "Jurisdiction",
  income: "Income",
  funds: "Funds",
};

function ProtocolCard({
  protocol,
  activeWallet,
}: {
  protocol: Protocol;
  activeWallet: string | null;
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<boolean[]>(protocol.requirements.map(() => false));
  const [checked, setChecked] = useState(false);
  const eligible = statuses.every(Boolean);
  const isPreview = usePreviewMode();

  useEffect(() => {
    if (isPreview) {
      setChecked(true);
      setStatuses(protocol.requirements.map(() => true));
      return;
    }
    if (!activeWallet) {
      setChecked(false);
      setStatuses(protocol.requirements.map(() => false));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          protocol.requirements.map((r) => checkClaim(activeWallet, r.type, r.minThreshold)),
        );
        if (!cancelled) setStatuses(results);
      } catch {
        // contracts not deployed
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [activeWallet, protocol.requirements]);

  return (
    <div
      className="card protocol-card"
      onClick={() => router.push(`/apps/${protocol.id}`)}
      style={{ display: "flex", flexDirection: "column", gap: 0, cursor: "pointer" }}
    >
      <div className="between" style={{ marginBottom: "0.35rem" }}>
        <span className="row" style={{ gap: "0.5rem", color: "var(--accent)", fontWeight: 600, fontSize: "1.1rem" }}>
          {protocol.icon}
          {protocol.name}
        </span>
        <div className="row" style={{ gap: "0.3rem" }}>
          {protocol.requirements.map((r, i) => {
            const isClaimMet = checked && statuses[i];
            return (
              <span
                key={r.type}
                style={{
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  background: isClaimMet ? "rgba(62,207,142,0.15)" : "rgba(255,255,255,0.05)",
                  color: isClaimMet ? "var(--accent)" : "var(--faint)",
                  border: `1px solid ${isClaimMet ? "rgba(62,207,142,0.35)" : "var(--border)"}`,
                }}
              >
                {CLAIM_LABELS[r.type] || r.type}
              </span>
            );
          })}
        </div>
      </div>
      <p className="mono faint" style={{ fontSize: "0.72rem", marginBottom: "0.75rem" }}>
        {protocol.tagline}
      </p>
      <p className="muted" style={{ fontSize: "0.8125rem", lineHeight: 1.65, marginBottom: "1.25rem" }}>
        {protocol.description}
      </p>
      <div
        style={{
          padding: "0.65rem 0.9rem",
          borderRadius: "var(--radius)",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid var(--border)",
          marginBottom: "1.25rem",
        }}
      >
        <div className="faint" style={{ fontSize: "0.72rem", marginBottom: "0.2rem" }}>{protocol.stat.label}</div>
        <div style={{ fontWeight: 600, fontSize: "1.5rem", letterSpacing: "-0.03em" }}>{protocol.stat.value}</div>
        <div className="mono faint" style={{ fontSize: "0.7rem" }}>{protocol.stat.sub}</div>
      </div>
      <div className="eyebrow" style={{ marginBottom: "0.4rem" }}>Requirements</div>
      <div className="stack">
        {protocol.requirements.map((r, i) => (
          <div className="line" key={r.label}>
            <span className="row" style={{ gap: "0.6rem" }}>
              {statuses[i]
                ? <IconCheck size={15} color="var(--accent)" stroke={2.5} />
                : <IconCircle size={15} color="var(--faint)" />}
              <span style={{ fontSize: "0.875rem", color: statuses[i] ? "var(--text)" : "var(--muted)" }}>
                {r.label}
              </span>
            </span>
            {statuses[i]
              ? <Badge variant="verified">Proved</Badge>
              : <Badge variant="pending">Needed</Badge>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AppsInner() {
  const { address, connect } = useWallet();
  const searchParams = useSearchParams();
  const scVerified = searchParams.get("sc_verified") === "true";
  const scWallet = searchParams.get("sc_wallet");
  const activeWallet = address ?? scWallet ?? null;

  const [search, setSearch] = useState("");
  const [selectedClaims, setSelectedClaims] = useState<Set<string>>(new Set());

  // QR Code Feature State
  const [credentialData, setCredentialData] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [encryptedQrData, setEncryptedQrData] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [verifyDeepLink, setVerifyDeepLink] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setVerifyDeepLink(`${window.location.origin}/verify?claimType=ProofOfHumanity&returnUrl=/success`);
    }
  }, []);

  const handleGenerateTransferQR = async () => {
    setQrError(null);
    if (!credentialData || !passphrase) {
      setQrError("Please provide both credential data and a passphrase.");
      return;
    }
    try {
      const payload = JSON.parse(credentialData) as Record<string, unknown>;
      const encrypted = await encryptPayload(payload, passphrase);
      setEncryptedQrData(encrypted);
    } catch (e) {
      setQrError("Invalid credential JSON format or encryption failed.");
    }
  };

  const toggleClaim = (claim: string) => {
    setSelectedClaims((prev) => {
      const next = new Set(prev);
      if (next.has(claim)) next.delete(claim);
      else next.add(claim);
      return next;
    });
  };

  const filtered = useMemo(() => {
    return PROTOCOLS.filter((p) => {
      const matchesSearch = !search.trim() ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase()) ||
        p.tagline.toLowerCase().includes(search.toLowerCase());
      const matchesClaims = selectedClaims.size === 0 ||
        p.requirements.some((r) => selectedClaims.has(r.type));
      return matchesSearch && matchesClaims;
    });
  }, [search, selectedClaims]);

  return (
    <>
      <div className="between" style={{ marginBottom: "2rem" }}>
        <div>
          <span className="eyebrow">Demo protocols</span>
          <h1 style={{ fontSize: "2rem", marginTop: "0.35rem" }}>Apps</h1>
        </div>
        <WalletButton />
      </div>

      <div
        style={{
          marginBottom: "1.75rem",
          padding: "0.75rem 1rem",
          borderRadius: "var(--radius)",
          background: "rgba(62,207,142,0.05)",
          border: "1px solid rgba(62,207,142,0.15)",
          fontSize: "0.8125rem",
          color: "var(--muted)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--text)" }}>Any protocol, any claim.</strong>{" "}
        Each app below gates access on a different credential type — one read-only call to{" "}
        <span className="mono" style={{ fontSize: "0.75rem" }}>ProofRegistry.is_verified</span>.
        The protocol never sees the credential, the commitment, or the proof itself.
      </div>

      {scVerified && (
        <div
          className="reveal"
          style={{
            marginBottom: "1.5rem",
            padding: "0.85rem 1rem",
            borderRadius: "var(--radius)",
            background: "rgba(62,207,142,0.08)",
            border: "1px solid rgba(62,207,142,0.35)",
            fontSize: "0.875rem",
            color: "var(--text)",
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
          }}
        >
          <IconCheck size={18} color="var(--accent)" stroke={2.5} />
          <span>
            <strong>Verification complete.</strong>{" "}
            <span className="muted">You were returned here from StellarCred automatically.</span>
          </span>
        </div>
      )}

      <ConfigBanner />

      {/* Search and filter */}
      <div className="stack" style={{ gap: "0.75rem", marginBottom: "1.5rem" }}>
        <div style={{ position: "relative" }}>
          <IconSearch
            size={16}
            stroke={1.8}
            color="var(--faint)"
            style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            type="text"
            placeholder="Search apps by name, description, or tagline..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "0.65rem 0.75rem 0.65rem 2.25rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              background: "var(--bg-raised)",
              color: "var(--text)",
              fontSize: "0.875rem",
            }}
          />
        </div>
        <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
          <IconFilter size={14} stroke={1.8} color="var(--faint)" />
          {CREDENTIAL_TYPES.map((claim) => {
            const isActive = selectedClaims.has(claim);
            return (
              <button
                key={claim}
                onClick={() => toggleClaim(claim)}
                type="button"
                style={{
                  padding: "0.3rem 0.7rem",
                  borderRadius: "999px",
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                  background: isActive ? "rgba(62,207,142,0.12)" : "transparent",
                  color: isActive ? "var(--accent)" : "var(--muted)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {CLAIM_LABELS[claim] || claim}
              </button>
            );
          })}
          {selectedClaims.size > 0 && (
            <button
              onClick={() => setSelectedClaims(new Set())}
              type="button"
              style={{
                padding: "0.3rem 0.7rem",
                borderRadius: "999px",
                fontSize: "0.72rem",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--faint)",
                cursor: "pointer",
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: "center", padding: "3.5rem 1.5rem", borderStyle: "dashed" }}
        >
          <IconSearch size={30} stroke={1.3} color="var(--faint)" />
          <h3 style={{ margin: "1rem 0 0.4rem" }}>No apps match</h3>
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            Try adjusting your search or removing claim filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-3" style={{ alignItems: "start", gap: "1.25rem" }}>
          {filtered.map((p) => (
            <ProtocolCard key={p.id} protocol={p} activeWallet={activeWallet} />
          ))}
        </div>
      )}

      {/* QR Code Features Section */}
      <div style={{ marginTop: "3rem", display: "grid", gridTemplateColumns: "1fr", gap: "1.5rem" }}>
        {/* Verify Request QR */}
        <div style={{ padding: "1.5rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-raised)" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text)", marginBottom: "0.5rem" }}>Verify Request QR</h2>
          <p className="muted" style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
            Scan this QR code with your mobile device to open the verification request.
          </p>
          <div style={{ display: "flex", justifyContent: "center", padding: "1rem", borderRadius: "var(--radius)", background: "#ffffff" }}>
            {verifyDeepLink ? (
              <QRCodeCanvas value={verifyDeepLink} size={256} fgColor="#000000" bgColor="#ffffff" />
            ) : (
              <div style={{ width: 256, height: 256 }} />
            )}
          </div>
        </div>

        {/* Credential Transfer QR */}
        <div style={{ padding: "1.5rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-raised)" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text)", marginBottom: "0.5rem" }}>Credential Transfer QR</h2>
          <p className="muted" style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
            Transfer your credential to another device securely. The payload will be encrypted with your passphrase.
          </p>
          <div className="stack" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <label className="faint" style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Credential Data (JSON)</label>
              <textarea
                className="mono"
                style={{
                  width: "100%",
                  padding: "0.65rem 0.75rem",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: "0.8125rem",
                  minHeight: "80px",
                  resize: "vertical"
                }}
                value={credentialData}
                onChange={(e) => setCredentialData(e.target.value)}
                placeholder='{"id":"123","type":"ProofOfHumanity","secret":"my_secret"}'
              />
            </div>
            <div>
              <label className="faint" style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Passphrase</label>
              <input
                type="password"
                style={{
                  width: "100%",
                  padding: "0.65rem 0.75rem",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: "0.875rem",
                }}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter a secure passphrase"
              />
            </div>
            {qrError && <p style={{ color: "#ef4444", fontSize: "0.8125rem" }}>{qrError}</p>}
            <button
              type="button"
              style={{
                padding: "0.65rem 1rem",
                borderRadius: "var(--radius)",
                background: "var(--accent)",
                color: "#000000",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.875rem",
              }}
              onClick={handleGenerateTransferQR}
            >
              Generate Encrypted QR
            </button>
          </div>
          {encryptedQrData && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "1rem", borderRadius: "var(--radius)", background: "#ffffff" }}>
              <QRCodeCanvas value={encryptedQrData} size={256} fgColor="#000000" bgColor="#ffffff" />
              <p style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.5rem", textAlign: "center", maxWidth: "200px" }}>
                Do not share this QR code publicly. Only someone with the passphrase can read the credential.
              </p>
            </div>
          )}
        </div>
      </div>

      <p className="faint" style={{ marginTop: "2rem", fontSize: "0.8rem", textAlign: "center", lineHeight: 1.6 }}>
        Go to <Link href="/holder" style={{ color: "var(--muted)" }}>Wallet</Link> to generate proofs from your credentials, then return here to unlock access.
      </p>
    </>
  );
}

export default function AppsPage() {
  return (
    <Suspense fallback={null}>
      <AppsInner />
    </Suspense>
  );
}