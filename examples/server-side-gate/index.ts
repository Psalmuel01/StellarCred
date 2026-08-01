/**
 * examples/server-side-gate/index.ts
 *
 * Minimal runnable SDK integration showing a server-side hasClaim gate.
 * Works as a Next.js Route Handler (app/api/...) or a plain Node.js server.
 *
 * Copy this file into your project, install @stellarcred/sdk, and fill the
 * environment variables below — you'll have a working credential gate in
 * minutes.
 *
 * Setup
 * -----
 * 1. npm install @stellarcred/sdk
 * 2. Set env vars (see .env.example below or pass opts to configure())
 * 3. Import the relevant gate function into your route handler
 *
 * .env.example
 * ------------
 * STELLARCRED_REGISTRY_ID=C...           # ProofRegistry contract ID (Stellar)
 * STELLARCRED_RPC_URL=https://soroban-testnet.stellar.org
 * NEXT_PUBLIC_APP_URL=https://your-app.example.com
 */

// ─── 1. Configure at startup (call once, e.g. in instrumentation.ts) ─────────

import StellarCred, {
  configure,
  hasClaim,
  buildVerifyUrl,
  parseReturnParams,
} from "@stellarcred/sdk";

// Option A: configure explicitly
configure({
  registryId: process.env.STELLARCRED_REGISTRY_ID ?? "",
  rpcUrl:
    process.env.STELLARCRED_RPC_URL ?? "https://soroban-testnet.stellar.org",
});

// Option B: set env vars and skip configure() — the SDK picks them up
// automatically if STELLARCRED_REGISTRY_ID and STELLARCRED_RPC_URL are set.
// Call healthCheck() at startup to confirm configuration before serving traffic.

const health = StellarCred.healthCheck();
if (!health.configured) {
  console.error("[StellarCred] misconfigured — missing:", health.missing);
  // Don't crash; gates will deny access until the config is fixed.
}

// ─── 2. Simple KYC gate ───────────────────────────────────────────────────────

/**
 * Enforce that the requesting wallet holds a valid KYC credential.
 * Drop this into any API route / middleware that requires identity verification.
 *
 * Usage (Next.js App Router):
 *
 *   export async function GET(request: Request) {
 *     const wallet = request.headers.get("x-wallet-address") ?? "";
 *     const gate = await kycGate(wallet, request.url);
 *     if (gate) return gate; // 302 → /verify or 403
 *     // proceed with verified request
 *     return Response.json({ data: "secret" });
 *   }
 */
export async function kycGate(
  wallet: string,
  currentUrl: string
): Promise<Response | null> {
  if (!wallet) {
    return new Response(JSON.stringify({ error: "No wallet address provided" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const verified = await hasClaim(wallet, "kyc");

  if (!verified) {
    // Redirect unverified users to StellarCred, with this page as the return URL
    const verifyUrl = buildVerifyUrl({
      claim: "kyc",
      returnUrl: currentUrl,
    });
    return Response.redirect(verifyUrl, 302);
  }

  return null; // wallet is KYC-verified — let the request through
}

// ─── 3. Funds gate with minThreshold and trusted issuers ─────────────────────

/**
 * Enforce that the wallet has proved a balance ≥ $50,000 from a specific issuer.
 *
 * `minThreshold` ensures the on-chain proof was generated with at least this
 * threshold — a proof for "balance ≥ 200,000" satisfies minThreshold: 50_000,
 * but a proof for "balance ≥ 10,000" does not.
 *
 * `trustedIssuers` further narrows which issuer signed the underlying credential.
 */
export async function fundsGate(
  wallet: string,
  currentUrl: string,
  {
    minBalance = 50_000,
    trustedIssuers,
  }: { minBalance?: number; trustedIssuers?: string[] } = {}
): Promise<Response | null> {
  if (!wallet) {
    return new Response(JSON.stringify({ error: "Wallet address required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const verified = await hasClaim(wallet, "funds", {
    minThreshold: minBalance,
    trustedIssuers,
  });

  if (!verified) {
    const verifyUrl = buildVerifyUrl({
      claim: "funds",
      returnUrl: currentUrl,
      claimParams: { threshold: String(minBalance) },
    });
    return Response.redirect(verifyUrl, 302);
  }

  return null;
}

// ─── 4. Handling the return redirect from StellarCred ────────────────────────

/**
 * Called in the route that receives the user back from /verify.
 *
 * IMPORTANT: `sc_verified=true` in the URL is an untrusted hint — never gate
 * on it directly. Always call hasClaim() server-side to confirm the claim.
 *
 * Usage (Next.js App Router):
 *
 *   export async function GET(request: Request) {
 *     return handleVerifyReturn(request);
 *   }
 */
export async function handleVerifyReturn(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // 1. Parse the untrusted return params (wallet + claimed types)
  const hint = parseReturnParams(url.searchParams);

  if (!hint.verified || !hint.wallet) {
    return new Response(JSON.stringify({ error: "Verification not completed" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Re-verify on-chain — the only thing that's actually trustworthy
  const isKyc = await hasClaim(hint.wallet, "kyc");

  if (!isKyc) {
    return new Response(
      JSON.stringify({ error: "On-chain claim check failed", wallet: hint.wallet }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Grant access — issue a session, set a cookie, etc.
  return new Response(
    JSON.stringify({
      ok: true,
      wallet: hint.wallet,
      claims: hint.claims,
      message: "Access granted — KYC verified on-chain",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ─── 5. Age-gate example ─────────────────────────────────────────────────────

/** Require wallet to have proved age ≥ 21. */
export async function ageGate(
  wallet: string,
  currentUrl: string,
  minAge = 21
): Promise<Response | null> {
  const verified = await hasClaim(wallet, "age", { minThreshold: minAge });
  if (!verified) {
    return Response.redirect(
      buildVerifyUrl({
        claim: "age",
        returnUrl: currentUrl,
        claimParams: { threshold_years: String(minAge) },
      }),
      302
    );
  }
  return null;
}

// ─── 6. Composable multi-claim gate ─────────────────────────────────────────

/**
 * Require ALL of the listed claims to be verified. Returns the first failing
 * gate response, or null if all pass.
 *
 * @example
 * const block = await allClaimsGate(wallet, url, ["kyc", { type: "funds", minThreshold: 50_000 }]);
 * if (block) return block;
 */
type ClaimRequirement =
  | string
  | { type: string; minThreshold?: number; trustedIssuers?: string[] };

export async function allClaimsGate(
  wallet: string,
  currentUrl: string,
  claims: ClaimRequirement[]
): Promise<Response | null> {
  for (const req of claims) {
    const type = typeof req === "string" ? req : req.type;
    const opts = typeof req === "string" ? undefined : { minThreshold: req.minThreshold, trustedIssuers: req.trustedIssuers };
    const ok = await hasClaim(wallet, type, opts);
    if (!ok) {
      return Response.redirect(
        buildVerifyUrl({ claim: type, returnUrl: currentUrl }),
        302
      );
    }
  }
  return null;
}
