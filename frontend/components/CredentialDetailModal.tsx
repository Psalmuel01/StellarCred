"use client";

import { useEffect, useRef, useState } from "react";
import { IconX, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import CopyButton from "./CopyButton";

function parseTtlSecs(expiry: string): number {
  const match = expiry.match(/(\d+)/);
  return (match ? parseInt(match[1]) : 30) * 86_400;
}

function formatDate(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface CredentialDetailModalProps {
  credential: {
    type: string;
    title: string;
    claim: string;
    issuer: string;
    issuerId: string;
    commitment: string;
    issuedAt: number;
    expiry: string;
    claimParams?: Record<string, unknown>;
  };
  onClose: () => void;
  /**
   * Optional: invoked with the full credential when the user asks to move it
   * to another device (passphrase-encrypted transfer QR). The caller owns
   * the full credential object; the modal only shows a summary.
   */
  onTransfer?: (credential: unknown) => void;
}

export default function CredentialDetailModal({ credential: c, onClose, onTransfer }: CredentialDetailModalProps) {
  const [showRaw, setShowRaw] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    prevFocusRef.current = document.activeElement as HTMLElement;
    const modal = modalRef.current;
    if (!modal) return;
    const focusable = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const current = modal!.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = current[0];
        const last = current[current.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      prevFocusRef.current?.focus();
    };
  }, []);

  const ttlSecs = parseTtlSecs(c.expiry);
  const expiryDate = c.issuedAt + ttlSecs;
  const rawJson = JSON.stringify({
    type: c.type,
    title: c.title,
    claim: c.claim,
    issuer: c.issuer,
    issuerId: c.issuerId,
    commitment: c.commitment,
    issuedAt: c.issuedAt,
    expiry: c.expiry,
    ...(c.claimParams ? { claimParams: c.claimParams } : {}),
  }, null, 2);

  const fields: Array<{ label: string; value: string }> = [
    { label: "Type", value: c.title },
    { label: "Issuer", value: c.issuer },
    { label: "Issuer ID", value: c.issuerId },
    { label: "Commitment", value: c.commitment },
    { label: "Issued", value: formatDateTime(c.issuedAt) },
    { label: "Expiry", value: `${formatDate(expiryDate)} (${c.expiry})` },
    { label: "Claim", value: c.claim },
  ];

  if (c.claimParams) {
    for (const [key, val] of Object.entries(c.claimParams)) {
      fields.push({
        label: key,
        value: Array.isArray(val) ? (val as unknown[]).join(", ") : String(val),
      });
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(6px)",
        }}
        onClick={onClose}
      />

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Credential details"
        className="card"
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "1.75rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="between" style={{ marginBottom: "1.25rem" }}>
          <span className="eyebrow">Credential details</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: "0.3rem 0.4rem", color: "var(--faint)" }}
          >
            <IconX size={16} />
          </button>
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          {fields.map((f, i) => (
            <div
              key={f.label}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                padding: "0.65rem 0.9rem",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                gap: "1rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "var(--muted)", flexShrink: 0 }}>{f.label}</span>
              <span
                className="mono"
                style={{
                  fontSize: "0.8rem",
                  color: "var(--text)",
                  textAlign: "right",
                  wordBreak: "break-all",
                  lineHeight: 1.5,
                }}
              >
                {f.value}
              </span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "1.25rem" }}>
          {onTransfer && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ width: "100%", marginBottom: "0.75rem", justifyContent: "center" }}
              onClick={() => onTransfer(c)}
            >
              Transfer to another device
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowRaw((v) => !v)}
            style={{
              fontSize: "0.72rem",
              padding: "0.2rem 0.5rem",
              color: "var(--faint)",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            {showRaw ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            {showRaw ? "Hide" : "Show"} raw JSON
          </button>
          {showRaw && (
            <div style={{ position: "relative", marginTop: "0.5rem" }}>
              <pre
                className="mono"
                style={{
                  fontSize: "0.68rem",
                  color: "var(--faint)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  lineHeight: 1.5,
                  maxHeight: 240,
                  overflowY: "auto",
                  background: "rgba(0,0,0,0.2)",
                  padding: "0.6rem 2.2rem 0.6rem 0.6rem",
                  borderRadius: "calc(var(--radius) - 2px)",
                  margin: 0,
                }}
              >
                {rawJson}
              </pre>
              <div style={{ position: "absolute", top: "0.4rem", right: "0.4rem" }}>
                <CopyButton value={rawJson} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
