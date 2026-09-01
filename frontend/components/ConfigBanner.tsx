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
      className="config-banner"
      role="alert"
    >
      <IconInfoCircle size={16} className="config-banner__icon" />
      <span className="config-banner__text">
        <strong className="config-banner__strong">App not fully configured.</strong>{" "}
        {requireIssuance ? "Credential issuance and " : "On-chain submission is "}
        disabled — missing env vars:{" "}
        <span className="config-banner__code">{allMissing.join(", ")}</span>. Run{" "}
        <span className="config-banner__code">./scripts/deploy.sh</span> and set them in{" "}
        <span className="config-banner__code">frontend/.env.local</span>.
      </span>
    </div>
  );
}
