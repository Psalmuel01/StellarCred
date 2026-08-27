"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import {
  contractsConfigured,
  issuanceConfigured,
  missingContractEnvVars,
  missingIssueConfigEnvVars,
} from "@/lib/config";

/**
 * Shown up front on any page with actions that depend on deploy config.
 * Uses the same shared checks as /api/ready (lib/config.ts), so the banner
 * and the readiness probe always agree on what "configured" means.
 *
 * Pass `requireIssuance` on pages whose primary action issues credentials
 * (/verify, /issuer): those additionally need NEXT_PUBLIC_ISSUER_ADDRESS and
 * IssuerRegistry, not just the contract IDs.
 */
export function ConfigBanner({ requireIssuance = false }: { requireIssuance?: boolean }) {
  const missing = missingContractEnvVars();
  const missingIssue = requireIssuance ? missingIssueConfigEnvVars() : [];
  const allMissing = Array.from(new Set([...missing, ...missingIssue]));
  if (allMissing.length === 0 && contractsConfigured() && (!requireIssuance || issuanceConfigured()))
    return null;
  if (allMissing.length === 0) return null;

  return (
    <div
      className="row"
      style={{
        gap: "0.6rem",
        padding: "0.7rem 1rem",
        marginBottom: "1.5rem",
        borderRadius: "var(--radius)",
        border: "1px solid var(--border-strong)",
        background: "var(--bg-soft)",
        fontSize: "0.8125rem",
        alignItems: "flex-start",
      }}
      role="alert"
    >
      <IconInfoCircle size={16} className="muted" style={{ flexShrink: 0, marginTop: 2 }} />
      <span className="muted">
        <strong style={{ color: "var(--text)" }}>App not fully configured.</strong>{" "}
        {requireIssuance ? "Credential issuance and " : ""}On-chain submission is
        disabled — missing env vars:{" "}
        <span className="mono">{allMissing.join(", ")}</span>. Run{" "}
        <span className="mono">./scripts/deploy.sh</span> and set them in{" "}
        <span className="mono">frontend/.env.local</span>.
      </span>
    </div>
  );
}
