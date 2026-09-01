import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CONTRACTS } from "@/lib/stellar";
import CopyButton from "@/components/CopyButton";

export const metadata: Metadata = {
  title: "Developers · StellarCred",
  description: "Integrate StellarCred in minutes — one contract call, no backend.",
};

function Code({ children }: { children: string }) {
  const lines = children.split("\n");
  return (
    <pre
      style={{
        fontFamily: "var(--font-mono), monospace",
        fontSize: "0.8rem",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1rem 1.25rem",
        overflowX: "auto",
        lineHeight: 1.7,
        margin: "0.75rem 0 0",
        whiteSpace: "pre",
      }}
    >
      <code>
        {lines.map((line, i) => (
          <span key={i}>
            <span style={{ color: line.trimStart().startsWith("//") ? "var(--faint)" : "var(--accent)" }}>
              {line}
            </span>
            {i < lines.length - 1 ? "\n" : null}
          </span>
        ))}
      </code>
    </pre>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: "3rem" }}>
      <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: "var(--text)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const CLAIMS: [string, string, string][] = [
  ["kyc", "Identity verified", "KYC provider"],
  ["age", "Age ≥ 18 (threshold configurable)", "KYC provider"],
  ["income", "Income ≥ threshold", "Financial data provider"],
  ["jurisdiction", "Country not restricted", "KYC provider"],
  ["funds", "Balance ≥ threshold", "Plaid / bank attestation"],
  ["accreditation", "Net worth ≥ threshold", "Financial institution"],
];

const ADDRESSES: [string, string][] = [
  ["NEXT_PUBLIC_ISSUER_REGISTRY_ID", CONTRACTS.issuerRegistry],
  ["NEXT_PUBLIC_CREDENTIAL_VERIFIER_ID", CONTRACTS.credentialVerifier],
  ["NEXT_PUBLIC_PROOF_REGISTRY_ID", CONTRACTS.proofRegistry],
  ["NEXT_PUBLIC_GATED_POOL_ID", CONTRACTS.gatedPool],
];

export default async function DevelopersPage({
  params,
}: {
  params: { locale: string };
}) {
  const t = await getTranslations({ locale: params.locale, namespace: "developers" });
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <span className="eyebrow">{t("eyebrow")}</span>
      <h1 style={{ fontSize: "2rem", marginTop: "0.35rem" }}>{t("title")}</h1>
      {/* <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.95rem", lineHeight: 1.6 }}>
        One contract call. No API keys. No data handling.{" "}
        <span style={{ color: "var(--accent)" }}>Verify once, trusted everywhere.</span>
      </p> */}

      <Section title={t("howItWorks")}>
        <p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.7 }}>
          {t("howItWorksBody")}{" "}
          <span className="mono">ProofRegistry</span>.
        </p>
      </Section>

      <Section title={t("installation")}>
        <Code>{`npm install @stellarcred/sdk`}</Code>
      </Section>

      <Section title={t("checkingAClaim")}>
        <p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.7 }}>
          {t("checkingAClaimBody")}
        </p>
        <Code>{`import { StellarCred } from "@stellarcred/sdk";

// Binary claim (kyc, jurisdiction) — no threshold
const kycOk = await StellarCred.hasClaim(wallet, "kyc");

// Age gate — proof must have been generated with threshold_years >= 21
const ageOk = await StellarCred.hasClaim(wallet, "age", { minThreshold: 21 });

// Funds gate — proof must certify balance >= $50,000
const fundsOk = await StellarCred.hasClaim(wallet, "funds", { minThreshold: 50000 });`}</Code>
      </Section>

      <Section title={t("fetchingAllClaims")}>
        <p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.7 }}>
          {t("fetchingAllClaimsBody")}
        </p>
        <Code>{`import { StellarCred } from "@stellarcred/sdk";

const claims = await StellarCred.getClaims(wallet);
// {
//   kyc:          { verified: true,  expiry: 1780000000 },
//   age:          { verified: true,  threshold: 21, expiry: 1780000000 },
//   income:       { verified: false },
//   jurisdiction: { verified: true,  expiry: 1780000000 },
//   funds:        { verified: false },
// }

// Gate on multiple claims at once
const canAccess = claims.kyc.verified && claims.age.verified;`}</Code>
      </Section>

      <Section title={t("configuration")}>
        <p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.7 }}>
          {t("configurationBody")}
        </p>
        <Code>{`import { StellarCred } from "@stellarcred/sdk";

// Option A — explicit (recommended for servers / edge)
StellarCred.configure({
  registryId: process.env.PROOF_REGISTRY_ID,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
});

// Option B — env vars (auto-read at import time)
// STELLARCRED_REGISTRY_ID=C...
// STELLARCRED_RPC_URL=https://soroban-testnet.stellar.org
// (also reads NEXT_PUBLIC_PROOF_REGISTRY_ID / NEXT_PUBLIC_RPC_URL)`}</Code>
        <p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.7, marginTop: "1rem" }}>
          {t("missingRegistryNote")}
        </p>
        <Code>{`const health = StellarCred.healthCheck();
// { configured: false, registryId: false, rpcUrl: true, networkPassphrase: true,
//   missing: ["registryId"] }
if (!health.configured) console.error("StellarCred misconfigured:", health.missing);

// Or just: StellarCred.isConfigured() // boolean`}</Code>
      </Section>

      <Section title={t("redirectingUsers")}>
        <p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.7 }}>
          {t("redirectingUsersBody")}
        </p>
        <Code>{`import { StellarCred } from "@stellarcred/sdk";

// KYC gate — basic redirect
const kycUrl = StellarCred.buildVerifyUrl({
  returnUrl: 'https://yourapp.xyz/deposit',
  claim: 'kyc',
});

// Age gate — require 21+
const ageUrl = StellarCred.buildVerifyUrl({
  returnUrl: 'https://yourapp.xyz/markets',
  claim: 'age',
  claimParams: { threshold_years: '21' },
});

// Funds gate — require balance ≥ $50,000
const fundsUrl = StellarCred.buildVerifyUrl({
  returnUrl: 'https://yourapp.xyz/vault',
  claim: 'funds',
  claimParams: { threshold: '50000' },
});

// The return URL includes sc_verified=true, sc_wallet=<address>, and sc_claims=<types>
// sc_claims contains only the claim types issued in the current session.
const verified = await StellarCred.hasClaim(wallet, "kyc");`}</Code>
        <p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.7, marginTop: "1rem" }}>
          {t("returnUrlNote")}
        </p>
        <Code>{`import { StellarCred } from "@stellarcred/sdk";

// On your return page:
const hint = StellarCred.parseReturnParams(window.location.href);
// hint: { verified, wallet, claims, state } — all untrusted

if (hint.verified && hint.wallet) {
  // Optimistic UI only. The real gate is this on-chain check:
  const reallyVerified = await StellarCred.hasClaim(hint.wallet, "kyc");
}

// Optional: pass a per-session token to correlate the redirect back to a
// session you started (still not a substitute for hasClaim):
const url = StellarCred.buildVerifyUrl({
  returnUrl: "https://yourapp.xyz/deposit",
  claim: "kyc",
  state: sessionNonce,
});
// ...later, on the return page:
if (hint.state !== expectedSessionNonce) {
  // redirect doesn't correlate to a session you started — treat as untrusted
}`}</Code>
      </Section>

      <Section title={t("availableClaimTypes")}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "0.75rem",
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.8rem",
          }}
        >
          <thead>
            <tr>
              {[t("claimHeader"), t("provesHeader"), t("issuedByHeader")].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "0.6rem 0.75rem",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--faint)",
                    fontWeight: 600,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CLAIMS.map(([claim, proves, by]) => (
              <tr key={claim}>
                <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--accent)" }}>
                  {claim}
                </td>
                <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                  {proves}
                </td>
                <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                  {by}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t("contractAddresses")}>
        <p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.7 }}>
          {t("contractAddressesBody")}{" "}
          <span className="mono">{process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet"}</span>.
        </p>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "0.75rem",
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.78rem",
          }}
        >
          <tbody>
            {ADDRESSES.map(([name, value]) => (
              <tr key={name}>
                <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--faint)", whiteSpace: "nowrap" }}>
                  {name}
                </td>
                <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--muted)", wordBreak: "break-all" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span>{value || t("notConfigured")}</span>
                    {value && <CopyButton value={value} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t("callingContractDirectly")}>
        <p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.7 }}>
          {t("callingContractDirectlyBody")}
        </p>
        <Code>{`// Binary claim (kyc, jurisdiction) — any registered issuer accepted
let registry = ProofRegistryClient::new(&env, &registry_id);
let (verified, _, _) = registry.is_verified(&holder, &symbol_short!("kyc"), &None);
require!(verified, Error::KycRequired);

// Parameterised claim — enforce minimum threshold on-chain
let eligible = registry.check_claim(&holder, &symbol_short!("funds"), &Some(50_000u64), &None);
require!(eligible, Error::InsufficientFunds);

// Restrict which issuer(s) a claim must come from
let trusted = vec![&env, persona_issuer.clone(), jumio_issuer.clone()];
let kyc_ok = registry.check_claim(&holder, &symbol_short!("kyc"), &None, &Some(trusted));
require!(kyc_ok, Error::KycRequired);`}</Code>
      </Section>

      <div style={{ height: "4rem" }} />
    </div>
  );
}
