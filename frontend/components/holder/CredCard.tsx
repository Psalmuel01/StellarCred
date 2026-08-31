"use client";

import { useState } from "react";
import {
  IconExternalLink,
  IconTrash,
  IconHistory,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Badge } from "@/components/Badge";
import { Timeline } from "@/components/Timeline";
import { truncateHash } from "@/lib/format";
import { EXPLORER_TX } from "@/lib/stellar";
import { proofSubmissionConfigured } from "@/lib/config";
import { useProofTimeline } from "@/lib/useProofTimeline";
import {
  proofStatus,
  isExpiringSoon,
  daysRemaining,
  credIsExpired,
  credExpiryTimestamp,
  credExpiryWithinDays,
  formatExpiryDate,
} from "@/lib/proof-helpers";
import type { Credential } from "@/lib/credential";

export function CredCard({
  c,
  address,
  onProve,
  onRemove,
  onInspect,
  isPreview,
}: {
  c: Credential;
  address: string;
  onProve: () => void;
  onRemove: () => void;
  onInspect?: () => void;
  isPreview?: boolean;
}) {
  const status = proofStatus(c);
  const { events } = useProofTimeline(c);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="card" style={{ padding: "1rem 1.25rem" }}>
      <div className="between" style={{ alignItems: "center", gap: "0.75rem" }}>
        {/* left: credential info */}
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{c.title}</span>
            <span className="mono faint" style={{ fontSize: "0.7rem" }}>{c.claim}</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--faint)", marginTop: "0.15rem" }}>
            <div>
              {c.issuer} &middot; <span>{truncateHash(c.commitment)}</span>
              {status === "proved" && (
                <>
                  {" "}
                  <span style={{ color: "var(--accent)", opacity: 0.75 }}>
                    expires in {daysRemaining(c)}d
                  </span>
                  {c.provedTxHash && (
                    <>
                      {" "}
                      <a
                        href={EXPLORER_TX(c.provedTxHash)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "inherit", display: "inline-flex", alignItems: "center", gap: "0.15rem" }}
                      >
                        {c.provedTxHash.slice(0, 6)}&hellip;<IconExternalLink size={10} />
                      </a>
                    </>
                  )}
                </>
              )}
              {status === "expired" && (
                <> <span style={{ color: "var(--danger)", opacity: 0.8 }}>expired</span></>
              )}
            </div>
            <div style={{ marginTop: "0.1rem" }}>
              {credIsExpired(c) ? (
                <span style={{ color: "var(--danger)", fontWeight: 500 }}>Expired</span>
              ) : (
                <span style={{ color: credExpiryWithinDays(c, 30) ? "var(--warn)" : "var(--faint)" }}>
                  Expires {formatExpiryDate(credExpiryTimestamp(c))}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* right: badges + buttons */}
        <div className="card-actions">
          {isPreview && <Badge variant="pending">Preview</Badge>}
          <Badge variant="verified" dot={false}>Held</Badge>
          {status === "proved" && !isExpiringSoon(c) && (
            <Badge variant="verified" dot={false}>On-chain</Badge>
          )}
          {status === "proved" && isExpiringSoon(c) && (
            <Badge variant="pending" dot={true}>Expiring in {daysRemaining(c)}d</Badge>
          )}
          {status === "expired" && (
            <Badge variant="denied" dot={true}>Proof Expired</Badge>
          )}
          {onInspect && (
            <button
              className="btn btn-ghost btn-sm"
              title="View details"
              onClick={onInspect}
              style={{ padding: "0.3rem 0.4rem", color: "var(--faint)" }}
            >
              <IconInfoCircle size={13} />
            </button>
          )}
          <button
            className={`btn btn-sm ${status === "proved" ? "btn-secondary" : "btn-primary"}`}
            disabled={!address || credIsExpired(c) || !proofSubmissionConfigured()}
            title={
              !address
                ? "Connect a wallet first"
                : credIsExpired(c)
                  ? "This credential has expired"
                  : !proofSubmissionConfigured()
                    ? "App not configured — NEXT_PUBLIC_PROOF_REGISTRY_ID missing"
                    : undefined
            }
            onClick={onProve}
          >
            {status === "proved" ? "Re-prove" :
             status === "expired" ? "Re-prove" :
                                    "Generate proof"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title="History"
            onClick={() => setShowHistory(!showHistory)}
            style={{ padding: "0.3rem 0.4rem", color: showHistory ? "var(--accent)" : "var(--faint)" }}
          >
            <IconHistory size={13} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title="Remove"
            onClick={onRemove}
            style={{ padding: "0.3rem 0.4rem", color: "var(--faint)" }}
          >
            <IconTrash size={13} />
          </button>
        </div>
      </div>

      {showHistory && (
        <Timeline events={events} />
      )}
    </div>
  );
}
