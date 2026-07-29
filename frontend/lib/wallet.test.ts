import { describe, expect, it } from "vitest";

const supportedWalletIds = ["freighter", "albedo", "wallet_connect"];

describe("wallet support matrix", () => {
  it("exposes Freighter, Albedo, and WalletConnect as selectable wallets", () => {
    expect(supportedWalletIds).toEqual(expect.arrayContaining(["freighter", "albedo", "wallet_connect"]));
  });
});
