## Summary

Only Freighter was reachable as a wallet in the app's own framing, even though the multi-wallet abstraction (`@creit.tech/stellar-wallets-kit`) was already integrated underneath. This closes the real gaps: WalletConnect wasn't wired in at all, error messaging assumed Freighter regardless of which wallet was picked, and the CSP silently blocked the wallet-picker modal's icons/relay/verify traffic in a real browser (only caught by driving a production build end-to-end, not by `tsc`/tests).

## What changed

### WalletConnect wired in (`frontend/lib/wallet.ts`)
- `allowAllModules()` already covers Freighter/Albedo/xBull/Rabet/Lobstr/Hana/Klever/HOT Wallet — it deliberately excludes WalletConnect because that module needs a project ID first.
- Manually instantiate `WalletConnectModule` (from the kit's `modules/walletconnect.module` subpath — not re-exported off the package root) and append it to the kit's `modules` array, gated on a new `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` env var.
- Unset = WalletConnect is simply omitted from the picker; every other wallet still works. No hard failure, no build-time requirement.

### Wallet-specific error context, not hardcoded Freighter
- `WalletConnectError` now carries `walletName`/`installUrl` sourced from the kit's own `ISupportedWallet` (`option.name`/`option.url`) at the point of failure, instead of a module-level constant that always pointed at Freighter.
- `WalletButton.tsx`'s "not installed" state now renders `Install {walletName}` linking to that wallet's own install URL, whichever wallet the user actually picked.
- WalletConnect itself is excluded from the "not-installed" classification (matched on `option.id === WALLET_CONNECT_ID`): it isn't a browser extension, so its own "not connected" errors mean a dropped relay socket or expired session, not something to install. Those now map to `"rejected"` instead of showing a misleading "Install WalletConnect" link.
- De-hardcoded remaining Freighter-only copy: `lib/contracts.ts`'s auth-failure message, `holder/page.tsx`'s proof-submission subtitles, and marketing/docs copy in `app/page.tsx`, `app/docs/page.tsx`, and the root `README.md`.

### CSP fixes (`frontend/next.config.mjs`) — found by actually running it, not just typechecking
Driving a real production build (`next build && next start`) in headless Chromium surfaced three concrete gaps the strict `Content-Security-Policy` header didn't account for:
- `connect-src` was missing the WalletConnect relay (`wss://relay.walletconnect.{com,org}`).
- No `frame-src` at all, so WalletConnect's domain-verification iframe (`verify.walletconnect.{com,org}`) was silently blocked.
- `img-src` didn't allow the wallet-picker's icon CDN — determined empirically from real network requests in a live browser (`stellar.creit.tech` for most wallets, `storage.herewallet.app` for HOT Wallet specifically; an earlier guess based on package-source greps pointed at the wrong domain).

All three WalletConnect-specific pieces (`frame-src` entirely, and the relay/verify/explorer entries in `connect-src`/`img-src`) are now gated on `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` being set, so a deployment that leaves WalletConnect disabled keeps the minimally-permissive CSP. `stellar.creit.tech` and `storage.herewallet.app` stay unconditional in `img-src` since they serve icons for every wallet the kit shows (Freighter, Albedo, etc.), not just WalletConnect's.

Also aliased `pino-pretty` to `false` in the webpack config — `@walletconnect/sign-client → @walletconnect/logger → pino` conditionally requires it, it's a dev-only transport this app doesn't use, and unresolved it was throwing a new build warning. This is pino's own documented bundler fix.

### Tests (`frontend/lib/__tests__/wallet.test.ts`, new)
No tests existed for `lib/wallet.ts` before this. Added 13, mocking `StellarWalletsKit` and `WalletConnectModule` (real extensions/relays aren't reachable from jsdom):
- `connect()` resolves the right address/walletId; rejects as `dismissed` on modal close.
- Regression guard: a "not installed" failure carries *that* wallet's name/url (e.g. connecting xBull or Lobstr no longer produces a Freighter-branded error).
- Regression guard: WalletConnect's own relay/session failures map to `"rejected"`, not `"not-installed"` with a bogus install link.
- `restore`, `signTx`, `getNetworkOk` (including the "don't false-positive a network mismatch if the wallet doesn't support `getNetwork()`" case).
- `getKit()` includes/excludes `WalletConnectModule` correctly based on whether the project-id env var is set.

## Why no custom wallet-picker UI
The kit's own `openModal()` already renders a picker listing every configured wallet, with unavailable ones visually marked "Not available" (clicking one opens its install page directly — confirmed in the kit's own modal source, not just docs). Building a second, custom picker on top would duplicate exactly what `@creit.tech/stellar-wallets-kit` is for.

## Test plan

- [x] `pnpm tsc --noEmit` — clean
- [x] `pnpm vitest run` — 15/15 passing (13 new + 2 existing)
- [x] `pnpm build` — clean, no warnings beyond a pre-existing unrelated `@stellar/stellar-sdk` deprecation notice
- [x] Drove a real production build (`next build && next start`) with headless Chromium: clicked "Connect wallet" on `/holder`, confirmed the picker lists Freighter/Albedo/xBull/Rabet/Lobstr/Hana/Klever/HOT Wallet/Wallet Connect, extension-only wallets correctly show "Not available", and zero CSP violations fire (before the `next.config.mjs` fix, icon loads and the picker itself were being blocked)
- [x] Confirmed build succeeds identically with `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` unset (matches CI's env) — WalletConnect just doesn't appear, nothing else regresses
- [x] Verified the CSP gating directly (`next.config.mjs`'s `headers()` called with the env var toggled): WalletConnect-specific `frame-src`/relay/verify/explorer entries appear only when the project ID is set
- [ ] Live connect/sign/submit against a real installed extension and a real WalletConnect relay (not possible in this sandbox — no browser-extension environment, no outbound DNS to `relay.walletconnect.com`)

## Notes for reviewers

- If you want WalletConnect live in a deployed environment, set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (free at https://cloud.reown.com) — documented in `frontend/.env.example`.
- The CSP domains (`stellar.creit.tech`, `storage.herewallet.app`, `explorer-api.walletconnect.com`, `verify.walletconnect.{com,org}`, `relay.walletconnect.{com,org}`) were verified against the actual installed dependency versions (`@creit.tech/stellar-wallets-kit@1.9.5`, `@walletconnect/sign-client@2.11.2`), not copied wholesale from WalletConnect's general AppKit docs (which include several domains — Coinbase, 1inch, WalletLink — this app's dependency tree doesn't actually use).
- `next.config.mjs`'s `headers()` runs server-side at runtime (each request/server-start), not baked in at build time — so `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` needs to be set wherever the server actually runs, not just at build time, for the CSP gating to reflect it correctly. (This tripped me up once during testing — worth knowing if the picker's icons ever look blocked in a deployed environment that *did* set the var at build time.)
