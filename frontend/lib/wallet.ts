"use client";

// Thin wrapper around Stellar Wallets Kit (Freighter, xBull, etc.).
// The kit's `network` option configures which network the kit signs for; it does
// NOT switch the wallet extension's own selected network. Network mismatches are
// therefore not treated as connect-time failures here — wallet-context.tsx polls
// getNetworkOk() live after connecting so the UI can show a persistent warning
// that clears itself the moment the user switches networks, without reconnecting.

import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FREIGHTER_ID,
  ALBEDO_ID,
  type ISupportedWallet,
  type StellarWalletsKit as StellarWalletsKitType,
} from "@creit.tech/stellar-wallets-kit";
import { WalletConnectModule } from "@creit.tech/stellar-wallets-kit/modules/walletconnect.module";
import { NETWORK, NETWORK_PASSPHRASE } from "./stellar";

const APP_NETWORK =
  NETWORK === "public" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;

const CONNECT_TIMEOUT_MS = 30_000;
const FREIGHTER_URL = "https://freighter.app";
const ALEDO_URL = "https://albedo.link";
const WALLET_CONNECT_URL = "https://walletconnect.com";

export interface SupportedWalletOption {
  id: string;
  name: string;
  description: string;
  installUrl?: string;
}

export const SUPPORTED_WALLETS: SupportedWalletOption[] = [
  {
    id: FREIGHTER_ID,
    name: "Freighter",
    description: "Browser extension wallet",
    installUrl: FREIGHTER_URL,
  },
  {
    id: ALBEDO_ID,
    name: "Albedo",
    description: "Browser extension wallet",
    installUrl: ALEDO_URL,
  },
  {
    id: "wallet_connect",
    name: "WalletConnect",
    description: "Mobile and desktop wallet connection",
    installUrl: WALLET_CONNECT_URL,
  },
];

let kit: StellarWalletsKitType | null = null;

export function getKit(): StellarWalletsKitType {
  if (!kit) {
    const walletConnectModule = new WalletConnectModule({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "demo-project-id",
      name: "StellarCred",
      description: "StellarCred wallet connection",
      url: "https://stellarcred.com",
      icons: ["https://stellarcred.com/icon.png"],
      method: "stellar_signAndSubmitXDR" as never,
      network: APP_NETWORK,
    });
    kit = new StellarWalletsKit({
      network: APP_NETWORK,
      selectedWalletId: FREIGHTER_ID,
      modules: [...allowAllModules(), walletConnectModule],
    });
  }
  return kit;
}

export type WalletErrorKind = "not-installed" | "dismissed" | "rejected" | "timeout" | "unknown";

export class WalletConnectError extends Error {
  kind: WalletErrorKind;
  constructor(kind: WalletErrorKind, message: string) {
    super(message);
    this.name = "WalletConnectError";
    this.kind = kind;
  }
}

export const FREIGHTER_INSTALL_URL = FREIGHTER_URL;

function toWalletError(e: unknown): WalletConnectError {
  if (e instanceof WalletConnectError) return e;
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : String(e);
  if (/not connected|not available|not installed|missing/i.test(message)) {
    return new WalletConnectError(
      "not-installed",
      "No Stellar wallet extension found. Install a supported wallet or try WalletConnect.",
    );
  }
  if (/cancel|dismiss|decline|rejected/i.test(message)) {
    return new WalletConnectError("rejected", "Connection cancelled");
  }
  return new WalletConnectError("unknown", message || "Something went wrong");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new WalletConnectError(
          "timeout",
          "Connection timed out. Check your wallet extension and try again.",
        ),
      );
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function getNetworkOk(): Promise<boolean> {
  try {
    const { networkPassphrase } = await getKit().getNetwork();
    return !networkPassphrase || networkPassphrase === NETWORK_PASSPHRASE;
  } catch {
    return true;
  }
}

export interface Connection {
  address: string;
  walletId: string;
}

export async function connect(): Promise<Connection> {
  const k = getKit();
  const attempt = new Promise<Connection>((resolve, reject) => {
    k.openModal({
      onWalletSelected: async (option: ISupportedWallet) => {
        try {
          k.setWallet(option.id);
          const { address } = await k.getAddress();
          resolve({ address, walletId: option.id });
        } catch (e) {
          reject(toWalletError(e));
        }
      },
      onClosed: () => reject(new WalletConnectError("dismissed", "Connection cancelled")),
    });
  });
  return withTimeout(attempt, CONNECT_TIMEOUT_MS);
}

export async function restore(walletId: string): Promise<string> {
  const k = getKit();
  k.setWallet(walletId);
  const { address } = await k.getAddress();
  return address;
}

export async function signTx(xdr: string, address: string): Promise<string> {
  const k = getKit();
  const { signedTxXdr } = await k.signTransaction(xdr, {
    address,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  return signedTxXdr;
}
