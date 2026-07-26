"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconKey,
  IconArrowRight,
  IconLoader2,
} from "@tabler/icons-react";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/lib/wallet-context";
import { Badge } from "@/components/Badge";
import { saveCredential, TYPE_META, type Credential } from "@/lib/credential";
import type { CredentialType } from "@/lib/stellar";
import CopyButton from "@/components/CopyButton";

const TYPES = Object.entries(TYPE_META) as [
  CredentialType,
  (typeof TYPE_META)[CredentialType],
][];

// Sensible default attribute per type (the issuer can change it).
const DEFAULT_ATTR: Record<CredentialType, string> = {
  kyc: "",
  age: "1995-06-15",
  income: "250000",
  jurisdiction: "566",
  funds: "50000",
};

const COUNTRIES = [
  { code: "566", name: "Nigeria" },
  { code: "276", name: "Germany" },
  { code: "356", name: "India" },
  { code: "840", name: "United States (restricted)" },
  { code: "364", name: "Iran (restricted)" },
];

export default function IssuerPage() {
  const { address } = useWallet();
  const issuerId = process.env.NEXT_PUBLIC_ISSUER_ADDRESS ?? address;
  const [holder, setHolder] = useState("");
  const [type, setType] = useState<CredentialType>("kyc");
  const [attribute, setAttribute] = useState(DEFAULT_ATTR.kyc);
  const [expiry, setExpiry] = useState("90 days");
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = useTranslations("issuer");

  const meta = TYPE_META[type];
  const needsAttr = !!meta.attribute;

  function onType(t: CredentialType) {
    setType(t);
    setAttribute(DEFAULT_ATTR[t]);
  }

  async function onIssue() {
    setBusy(true);
    setError("");
    try {
      // Map this page's single attribute onto the shared attributes shape, then
      // request one credential type wrapped in an array (multi-claim API).
      const attributes: Record<string, string> = {};
      if (type === "age") attributes.date_of_birth = attribute;
      else if (type === "income") attributes.income = attribute;
      else if (type === "jurisdiction") attributes.country_code = attribute;

      const res = await fetch("/api/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential_types: [type],
          holder,
          issuerId,
          issuerName: "StellarCred Authority",
          expiry,
          attributes,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { credentials } = (await res.json()) as { credentials: Credential[] };
      const cred = credentials[0];
      saveCredential(cred);
      setIssued(JSON.stringify(cred, null, 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="between" style={{ marginBottom: "2rem" }}>
        <div>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1 style={{ fontSize: "2rem", marginTop: "0.35rem" }}>{t("title")}</h1>
        </div>
        <WalletButton />
      </div>

      <div style={{ marginBottom: "1.75rem", padding: "0.75rem 1rem", borderRadius: "var(--radius)", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", fontSize: "0.8125rem", color: "var(--muted)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--text)" }}>{t("simulationStrong")}</strong>{" "}
        {t("simulationNote")}
      </div>

      <div className="grid grid-2" style={{ alignItems: "start", gap: "1.5rem" }}>
        <div className="card">
          <label className="field-label">{t("holderAddress")}</label>
          <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder={t("holderPlaceholder")} />

          <div className="grid grid-2" style={{ marginTop: "1.25rem", gap: "1rem" }}>
            <div>
              <label className="field-label">{t("credentialType")}</label>
              <select value={type} onChange={(e) => onType(e.target.value as CredentialType)}>
                {TYPES.map(([key, m]) => (
                  <option key={key} value={key}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">{t("expiry")}</label>
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                {([["30 days", t("expiry30")], ["90 days", t("expiry90")], ["1 year", t("expiry1year")]] as [string, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {needsAttr && (
            <div style={{ marginTop: "1.25rem" }}>
              <label className="field-label">{meta.attribute}</label>
              {type === "age" ? (
                <input type="date" value={attribute} onChange={(e) => setAttribute(e.target.value)} />
              ) : type === "jurisdiction" ? (
                <select value={attribute} onChange={(e) => setAttribute(e.target.value)}>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  value={attribute}
                  onChange={(e) => setAttribute(e.target.value)}
                />
              )}
            </div>
          )}

          <div className="row faint" style={{ marginTop: "1.25rem", fontSize: "0.8125rem" }}>
            <IconKey size={14} />
            <span>
              {needsAttr ? t("poseidonAttr") : t("poseidonSecret")}
            </span>
          </div>

          <button
            className="btn btn-primary"
            style={{ marginTop: "1.5rem", width: "100%" }}
            disabled={!holder || !issuerId || (needsAttr && !attribute) || busy}
            title={!issuerId ? t("connectIssuerFirst") : undefined}
            onClick={onIssue}
          >
            {busy ? (
              <>
                <IconLoader2 size={15} className="spin" />
                {t("computing")}
              </>
            ) : (
              <>
                {t("signAndIssue")}
                <IconArrowRight size={15} />
              </>
            )}
          </button>
          {!issuerId && (
            <p className="faint" style={{ marginTop: "0.6rem", fontSize: "0.8125rem" }}>
              {t("connectIssuerNote")}
            </p>
          )}
          {error && (
            <p style={{ marginTop: "0.6rem", fontSize: "0.8125rem", color: "var(--danger)" }}>
              {error}
            </p>
          )}
        </div>

        <div className="card" style={{ minHeight: 280 }}>
          <div className="between" style={{ marginBottom: "1rem" }}>
            <span className="eyebrow">{t("signedCredential")}</span>
            {issued && (
              <div className="row" style={{ gap: "0.5rem" }}>
                <Badge variant="verified">{t("savedToWallet")}</Badge>
                <CopyButton value={issued} />
              </div>
            )}
          </div>
          {issued ? (
            <pre
              className="mono"
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "var(--muted)",
                lineHeight: 1.7,
                maxHeight: 380,
                overflow: "auto",
              }}
            >
              {issued}
            </pre>
          ) : (
            <div style={{ height: 200, display: "grid", placeItems: "center", textAlign: "center" }}>
              <p className="faint" style={{ maxWidth: 280, fontSize: "0.875rem" }}>
                {t("emptyIssuer")}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
