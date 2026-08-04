// Coverage for the trigger/lifecycle wiring in use-warm-prover.ts. The
// backend cache mechanics themselves (reuse, double-init guard, graceful
// failure) are covered in proof.test.ts against the real cache; here we only
// verify the hook calls into that cache correctly and at the right times.

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CredentialType } from "./stellar";

const { warmBackend, destroyAllBackends } = vi.hoisted(() => ({
  warmBackend: vi.fn(),
  destroyAllBackends: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./proof", () => ({ warmBackend, destroyAllBackends }));

import { useWarmProver } from "./use-warm-prover";

interface Props {
  types: CredentialType[];
  enabled: boolean;
}

describe("useWarmProver", () => {
  beforeEach(() => {
    warmBackend.mockClear();
    destroyAllBackends.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not warm when disabled (wallet not connected)", () => {
    renderHook(() => useWarmProver(["age", "kyc"], false));
    expect(warmBackend).not.toHaveBeenCalled();
  });

  it("warms every given type once enabled", () => {
    renderHook(() => useWarmProver(["age", "kyc"], true));
    expect(warmBackend).toHaveBeenCalledTimes(2);
    expect(warmBackend).toHaveBeenCalledWith("age");
    expect(warmBackend).toHaveBeenCalledWith("kyc");
  });

  it("does not re-warm on a re-render with the same types", () => {
    const { rerender } = renderHook(
      ({ types, enabled }: Props) => useWarmProver(types, enabled),
      { initialProps: { types: ["age"], enabled: true } },
    );
    expect(warmBackend).toHaveBeenCalledTimes(1);

    // A fresh array instance with identical contents should not re-trigger
    // warming -- the hook keys its effect off the joined type list, not
    // array identity.
    rerender({ types: ["age"], enabled: true });
    expect(warmBackend).toHaveBeenCalledTimes(1);
  });

  it("re-warms when the set of unproved types changes", () => {
    const { rerender } = renderHook(
      ({ types, enabled }: Props) => useWarmProver(types, enabled),
      { initialProps: { types: ["age"], enabled: true } },
    );
    expect(warmBackend).toHaveBeenCalledTimes(1);

    // The effect re-fires for the whole new list (warmBackend/getBackend is
    // cheap to call again for an already-warm type -- see proof.test.ts's
    // cache-reuse coverage), so "age" is called again alongside the new
    // "kyc" rather than only the newly-added type.
    rerender({ types: ["age", "kyc"], enabled: true });
    expect(warmBackend).toHaveBeenCalledTimes(3);
    expect(warmBackend).toHaveBeenLastCalledWith("kyc");
  });

  it("starts warming once the wallet transitions from disconnected to connected", () => {
    const { rerender } = renderHook(
      ({ types, enabled }: Props) => useWarmProver(types, enabled),
      { initialProps: { types: ["age"], enabled: false } },
    );
    expect(warmBackend).not.toHaveBeenCalled();

    rerender({ types: ["age"], enabled: true });
    expect(warmBackend).toHaveBeenCalledTimes(1);
  });

  it("destroys every cached backend on unmount", () => {
    const { unmount } = renderHook(() => useWarmProver(["age"], true));
    expect(destroyAllBackends).not.toHaveBeenCalled();

    unmount();
    expect(destroyAllBackends).toHaveBeenCalledTimes(1);
  });

  it("destroys every cached backend on beforeunload", () => {
    renderHook(() => useWarmProver(["age"], true));
    window.dispatchEvent(new Event("beforeunload"));
    expect(destroyAllBackends).toHaveBeenCalledTimes(1);
  });

  it("removes its beforeunload listener on unmount (no leak, no double-destroy)", () => {
    const { unmount } = renderHook(() => useWarmProver(["age"], true));
    unmount();
    destroyAllBackends.mockClear();

    window.dispatchEvent(new Event("beforeunload"));
    expect(destroyAllBackends).not.toHaveBeenCalled();
  });
});
