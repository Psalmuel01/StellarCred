"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  IconArrowRight,
  IconLoader2,
  IconCheck,
  IconBuildingBank,
} from "@tabler/icons-react";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/lib/wallet-context";
import { saveCredential, TYPE_META, type Credential } from "@/lib/credential";
import type { CredentialType } from "@/lib/stellar";

const TYPES = Object.entries(TYPE_META) as [
  CredentialType,
  (typeof TYPE_META)[CredentialType],
][];

const COUNTRIES = [
  { code: "566", name: "Nigeria" },
  { code: "276", name: "Germany" },
  { code: "356", name: "India" },
  { code: "840", name: "United States (restricted)" },
  { code: "364", name: "Iran (restricted)" },
];

const DEMO_ISSUER_ID = process.env.NEXT_PUBLIC_ISSUER_ADDRESS ?? "";
const VALID_CLAIMS = TYPES.map(([k]) => k);

function VerifyInner() {
  const router = useRouter();
  const { address } = useWallet();
  const searchParams = useSearchParams();
  const t = useTranslations("verify");

  const returnUrl = searchParams.get("return_url");
  const personaInquiryId = searchParams.get("inquiry-id");
  const claimParam = searchParams.get("claim") as CredentialType | null;
  const requiredClaim = claimParam && VALID_CLAIMS.includes(claimParam) ? claimParam : null;
  const locked = !!requiredClaim;

  const claimParamsFromUrl = {
    threshold_years: searchParams.get("threshold_years") ?? undefined,
    threshold: searchParams.get("threshold") ?? undefined,
    restricted: searchParams.get("restricted")?.split(",").filter(Boolean) ?? undefined,
  };

  const [selected, setSelected] = useState<CredentialType | null>(
    requiredClaim ?? (TYPES[0]?.[0] ?? null),
  );
  const [attributes, setAttributes] = useState<Record<string, string>>({
    date_of_birth: "1995-06-15",
    income: "250000",
    country_code: "566",
  });
  const [expiry, setExpiry] = useState("90 days");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urlError, setUrlError] = useState("");
  const [done, setDone] = useState(false);
  const [plaidBalance, setPlaidBalance] = useState<number | null>(null);
  const [plaidAccounts, setPlaidAccounts] = useState<{ name: string; available: number }[]>([]);
  const [plaidMock, setPlaidMock] = useState(false);

  const fundsSelected = selected === "funds";
  useEffect(() => {
    if (!fundsSelected) return;
    setPlaidBalance(null);
    fetch("/api/plaid-balance")
      .then((r) => r.json())
      .then((d: { balance?: number; accounts?: { name: string; available: number }[]; mock?: boolean; error?: string }) => {
        if (d.balance !== undefined) {
          setPlaidBalance(d.balance);
          setPlaidAccounts(d.accounts ?? []);
          setPlaidMock(!!d.mock);
        }
      })
      .catch(() => {});
  }, [fundsSelected]);

  useEffect(() => {
    if (!personaInquiryId || !address) return;
    const raw = sessionStorage.getItem("sc_persona_pending");
    if (!raw) return;
    sessionStorage.removeItem("sc_persona_pending");
    let pending: Record<string, unknown>;
    try { pending = JSON.parse(raw); } catch { return; }
    setBusy(true);
    setError("");
    fetch("/api/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pending, persona_inquiry_id: personaInquiryId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(d?.error ?? "Issuing failed after identity verification");
        }
        return res.json() as Promise<{ credentials: import("@/lib/credential").Credential[] }>;
      })
      .then(({ credentials }) => {
        credentials.forEach((c) => saveCredential(c));
        setDone(true);
        setTimeout(redirectAfterIssue, 1500);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaInquiryId, address]);

  function setAttr(key: string, val: string) {
    setAttributes((a) => ({ ...a, [key]: val }));
  }

  function redirectAfterIssue() {
    if (returnUrl && address) {
      let dest;
      try {
        dest = new URL(returnUrl, window.location.origin);
        if (dest.protocol !== "https:" && dest.origin !== window.location.origin) {
          setUrlError("Invalid return_url: only https URLs are allowed");
          return;
        }
      } catch {
        setUrlError("Invalid return_url: could not parse URL");
        return;
      }
      dest.searchParams.set("sc_verified", "true");
      dest.searchParams.set("sc_wallet", address);
      if (dest.origin === window.location.origin) {
        router.push(dest.pathname + dest.search);
      } else {
        window.location.href = dest.toString();
      }
    } else {
      router.push("/holder");
    }
  }

  let returnLabel = "";
  let returnUrlIsValid = false;
  if (returnUrl) {
    try {
      const u = new URL(returnUrl, window.location.origin);
      if (u.protocol === "https:" || u.origin === window.location.origin) {
        returnUrlIsValid = true;
      }
    } catch { /* invalid */ }
  }
  if (returnUrl && returnUrlIsValid) {
    if (returnUrl.startsWith("/")) {
      returnLabel = returnUrl;
    } else {
      try { returnLabel = new URL(returnUrl).hostname; }
      catch { returnLabel = returnUrl; }
    }
  }

  async function onRequest() {
    if (!address || !selected) return;
    setBusy(true);
    setError("");
    try {
      if (!DEMO_ISSUER_ID) throw new Error("NEXT_PUBLIC_ISSUER_ADDRESS is not set — cannot issue credentials");
      const payload = {
        credential_types: [selected],
        holder: address,
        issuerId: DEMO_ISSUER_ID,
        issuerName: "StellarCred Authority",
        expiry,
        attributes,
        claimParams: claimParamsFromUrl,
      };
      const res = await fetch("/api/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 202) {
        const { personaUrl } = (await res.json()) as { personaUrl: string };
        sessionStorage.setItem("sc_persona_pending", JSON.stringify(payload));
        window.location.href = personaUrl;
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Issuing failed");
      }
      const { credentials } = (await res.json()) as { credentials: Credential[] };
      credentials.forEach((c) => saveCredential(c));
      setDone(true);
      setTimeout(redirectAfterIssue, 1500);
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

      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <div className="card">
          {!address ? (
            <div style={{ textAlign: "center", padding: "2rem 0" }}>
              <p className="muted" style={{ marginBottom: "1.25rem", fontSize: "0.9rem" }}>
                {t("connectWallet")}
              </p>
              <WalletButton />
            </div>
          ) : done ? (
            <div className="reveal" style={{ textAlign: "center", padding: "2rem 0" }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: "50%", background: "var(--accent-soft)", marginBottom: "1rem" }}>
                <IconCheck size={24} color="var(--accent)" stroke={2.5} />
              </span>
              <div style={{ fontWeight: 500 }}>
                {returnUrlIsValid ? t("verified") : t("credentialSaved")}
              </div>
              <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
                {returnUrlIsValid ? t("returningTo", { label: returnLabel }) : t("redirectingToWallet")}
              </div>
            </div>
          ) : (
            <>
              <label className="field-label">{t("credentialType")}</label>
              {locked && (
                <p className="faint" style={{ fontSize: "0.8125rem", margin: "0.4rem 0 0" }}>
                  {returnUrlIsValid
                    ? t("requestedBy", { app: returnLabel, claim: requiredClaim })
                    : t("protocolRequested", { claim: requiredClaim })}
                </p>
              )}
              <div className="stack" style={{ gap: "0.5rem", marginTop: "0.5rem", marginBottom: "1.25rem" }}>
                {TYPES.map(([key, m]) => {
                  const on = selected === key;
                  if (locked && key !== requiredClaim) return null;
                  return (
                    <div
                      key={key}
                      onClick={() => { if (!locked) setSelected(key); }}
                      style={{
                        padding: "0.75rem 0.9rem",
                        borderRadius: "var(--radius)",
                        border: `1px solid ${on ? "rgba(62,207,142,0.4)" : "var(--border)"}`,
                        background: on ? "rgba(62,207,142,0.05)" : "transparent",
                        cursor: locked ? "default" : "pointer",
                        transition: "border-color 0.2s var(--ease), background 0.2s var(--ease)",
                      }}
                    >
                      <div className="between" style={{ alignItems: "center" }}>
                        <span className="row" style={{ gap: "0.6rem" }}>
                          <span style={{ width: 16, height: 16, borderRadius: "50%", display: "grid", placeItems: "center", border: `2px solid ${on ? "var(--accent)" : "var(--border)"}`, flexShrink: 0 }}>
                            {on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />}
                          </span>
                          <span style={{ fontWeight: 500, fontSize: "0.9rem" }}>{m.title}</span>
                        </span>
                        <span className="mono faint" style={{ fontSize: "0.72rem" }}>
                          {key === "funds" && claimParamsFromUrl.threshold
                            ? `balance > ${Number(claimParamsFromUrl.threshold).toLocaleString("en-US")}`
                            : key === "age" && claimParamsFromUrl.threshold_years
                              ? `age ≥ ${claimParamsFromUrl.threshold_years}`
                              : key === "income" && claimParamsFromUrl.threshold
                                ? `income > ${Number(claimParamsFromUrl.threshold).toLocaleString("en-US")}`
                                : m.claim}
                        </span>
                      </div>
                      {on && key === "kyc" && (
                        <p className="faint" style={{ fontSize: "0.75rem", margin: "0.5rem 0 0" }}>{t("kycNote")}</p>
                      )}
                      {on && key === "age" && (
                        <div style={{ marginTop: "0.75rem" }} onClick={(e) => e.stopPropagation()}>
                          <label className="field-label">{m.attribute}</label>
                          <input type="date" value={attributes.date_of_birth} onChange={(e) => setAttr("date_of_birth", e.target.value)} />
                        </div>
                      )}
                      {on && key === "income" && (
                        <div style={{ marginTop: "0.75rem" }} onClick={(e) => e.stopPropagation()}>
                          <label className="field-label">{m.attribute}</label>
                          <input type="number" value={attributes.income} onChange={(e) => setAttr("income", e.target.value)} />
                        </div>
                      )}
                      {on && key === "funds" && (
                        <div style={{ marginTop: "0.75rem" }} onClick={(e) => e.stopPropagation()}>
                          {plaidBalance === null ? (
                            <p className="faint" style={{ fontSize: "0.75rem", margin: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              <IconLoader2 size={12} className="spin" />
                              {t("readingPlaid")}
                            </p>
                          ) : (
                            <div style={{ padding: "0.65rem 0.9rem", borderRadius: "var(--radius)", background: "rgba(62,207,142,0.05)", border: "1px solid rgba(62,207,142,0.2)" }}>
                              <div className="between" style={{ alignItems: "center", marginBottom: plaidAccounts.length > 1 ? "0.5rem" : 0 }}>
                                <span className="row" style={{ gap: "0.4rem", fontSize: "0.75rem", color: "var(--faint)" }}>
                                  <IconBuildingBank size={12} stroke={1.6} />
                                  {plaidMock ? t("mockBalance") : t("verifiedBalance")}
                                </span>
                                <span style={{ fontWeight: 600, fontSize: "1rem", color: "var(--text)" }}>${plaidBalance.toLocaleString("en-US")}</span>
                              </div>
                              {plaidAccounts.length > 1 && (
                                <div className="stack" style={{ gap: "0.2rem" }}>
                                  {plaidAccounts.map((a) => (
                                    <div key={a.name} className="between" style={{ fontSize: "0.72rem" }}>
                                      <span className="faint">{a.name}</span>
                                      <span className="mono" style={{ color: "var(--muted)" }}>${a.available.toLocaleString("en-US")}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <hr style={{ margin: "0.5rem 0", borderColor: "rgba(62,207,142,0.15)" }} />
                              <div className="between" style={{ alignItems: "center" }}>
                                <span className="faint" style={{ fontSize: "0.72rem" }}>{t("proofWillCertify")}</span>
                                <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--accent)" }}>
                                  balance ≥ ${Number(claimParamsFromUrl.threshold ?? "10000").toLocaleString("en-US")}
                                </span>
                              </div>
                              <p className="faint" style={{ fontSize: "0.72rem", margin: "0.35rem 0 0" }}>{t("balancePrivacy")}</p>
                            </div>
                          )}
                        </div>
                      )}
                      {on && key === "jurisdiction" && (
                        <div style={{ marginTop: "0.75rem" }} onClick={(e) => e.stopPropagation()}>
                          <label className="field-label">{m.attribute}</label>
                          <select value={attributes.country_code} onChange={(e) => setAttr("country_code", e.target.value)}>
                            {COUNTRIES.map((c) => (
                              <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginBottom: "1.5rem" }}>
                <label className="field-label">{t("validityPeriod")}</label>
                <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                  {([["30 days", t("expiry30")], ["90 days", t("expiry90")], ["1 year", t("expiry1year")]] as [string, string][]).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="line" style={{ marginBottom: "1.5rem", padding: "0.75rem 1rem", borderRadius: "var(--radius)", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                <span className="faint" style={{ fontSize: "0.8125rem" }}>{t("issuedTo")}</span>
                <span className="mono" style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
              </div>

              <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy || !selected} onClick={onRequest}>
                {busy ? (
                  <>
                    <IconLoader2 size={15} className="spin" />
                    {selected === "kyc" ? t("redirecting") : t("creating")}
                  </>
                ) : (
                  <>
                    {selected === "kyc" ? t("verifyIdentity") : t("getCredential")}
                    <IconArrowRight size={15} />
                  </>
                )}
              </button>

              {(error || urlError) && (
                <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--danger)" }}>
                  {error || urlError}
                </p>
              )}

              <p className="faint" style={{ marginTop: "1.25rem", fontSize: "0.8125rem", lineHeight: 1.6 }}>
                {t("poseidonNote")}
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
