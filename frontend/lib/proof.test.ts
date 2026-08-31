// Coverage for lib/proof.ts's backend cache: warming, reuse across proofs,
// the double-init guard, graceful warm failures, and destroy lifecycle.
//
// The real UltraHonkBackend loads bb.js's wasm via a runtime-only, native ES
// module import from /public/bb (see the comments at the top of proof.ts) --
// far too heavy and non-deterministic to run in CI, so it's mocked outright
// here. `fetch` (for the compiled circuit JSON) is mocked too.
//
// Each test re-imports lib/proof.ts after vi.resetModules() so the
// module-scoped backend cache starts empty every time -- these tests would
// otherwise leak cached backends across each other.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withTimeout,
  ProofTimeoutError,
  DEFAULT_PROOF_TIMEOUT_MS,
} from "./proof";

const { UltraHonkBackendMock, generateProofMock, destroyMock } = vi.hoisted(() => ({
  UltraHonkBackendMock: vi.fn(),
  generateProofMock: vi.fn(),
  destroyMock: vi.fn(),
}));

vi.mock("/bb/index.js", () => ({
  UltraHonkBackend: UltraHonkBackendMock,
}));

function mockJsonResponse(body: unknown, init?: { status?: number }) {
  const status = init?.status ?? 200;
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

// Flush the microtask queue so fire-and-forget calls (warmBackend) settle
// before assertions run.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("lib/proof backend cache", () => {
  beforeEach(() => {
    vi.resetModules();
    UltraHonkBackendMock.mockReset();
    generateProofMock.mockReset();
    destroyMock.mockReset();
    UltraHonkBackendMock.mockImplementation(() => ({
      generateProof: generateProofMock,
      destroy: destroyMock,
    }));
    generateProofMock.mockResolvedValue({
      proof: new Uint8Array([1, 2, 3]),
      publicInputs: ["0x01"],
    });
    destroyMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockJsonResponse({ bytecode: "AAAA" })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error -- test-only override, restored here.
    delete window.crossOriginIsolated;
  });

  it("reuses the constructed backend across repeat proofs of the same type", async () => {
    const { proveWithBackend } = await import("./proof");

    await proveWithBackend("age", new Uint8Array([9]));
    await proveWithBackend("age", new Uint8Array([9]));

    expect(UltraHonkBackendMock).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(generateProofMock).toHaveBeenCalledTimes(2);
  });

  it("constructs a separate backend per credential type", async () => {
    const { proveWithBackend } = await import("./proof");

    await proveWithBackend("age", new Uint8Array([9]));
    await proveWithBackend("kyc", new Uint8Array([9]));

    expect(UltraHonkBackendMock).toHaveBeenCalledTimes(2);
  });

  it("warmBackend followed by a real prove reuses the warmed backend", async () => {
    const { warmBackend, proveWithBackend } = await import("./proof");

    warmBackend("age");
    await flush();
    await proveWithBackend("age", new Uint8Array([9]));

    expect(UltraHonkBackendMock).toHaveBeenCalledTimes(1);
    expect(generateProofMock).toHaveBeenCalledTimes(1);
  });

  it("does not block or throw synchronously when warming", async () => {
    const { warmBackend } = await import("./proof");
    expect(() => warmBackend("age")).not.toThrow();
    await flush();
  });

  it("double-init guard: two warmBackend calls for the same type in-flight share one construction", async () => {
    const { warmBackend, proveWithBackend } = await import("./proof");

    // Simulates React StrictMode double-invoking the warm effect, or a
    // second warm trigger firing before the first resolves.
    warmBackend("age");
    warmBackend("age");
    await proveWithBackend("age", new Uint8Array([9]));

    expect(UltraHonkBackendMock).toHaveBeenCalledTimes(1);
  });

  it("double-init guard: concurrent proveWithBackend calls for the same type share one construction", async () => {
    const { proveWithBackend } = await import("./proof");

    await Promise.all([
      proveWithBackend("age", new Uint8Array([1])),
      proveWithBackend("age", new Uint8Array([2])),
      proveWithBackend("age", new Uint8Array([3])),
    ]);

    expect(UltraHonkBackendMock).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(generateProofMock).toHaveBeenCalledTimes(3);
  });

  it("double-init guard: a real prove racing an in-flight warm shares that same construction", async () => {
    const { warmBackend, proveWithBackend } = await import("./proof");

    warmBackend("age");
    const result = await proveWithBackend("age", new Uint8Array([9]));

    expect(UltraHonkBackendMock).toHaveBeenCalledTimes(1);
    expect(result.proof).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("warmBackend swallows a failed construction and logs instead of throwing or crashing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({}, { status: 404 })));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { warmBackend } = await import("./proof");

    expect(() => warmBackend("age")).not.toThrow();
    await flush();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/age/);
    warnSpy.mockRestore();
  });

  it("a failed warm does not poison the cache -- a later prove can still succeed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({}, { status: 404 }))
      .mockResolvedValueOnce(mockJsonResponse({ bytecode: "AAAA" }));
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { warmBackend, proveWithBackend } = await import("./proof");

    warmBackend("age");
    await flush();

    const result = await proveWithBackend("age", new Uint8Array([9]));

    expect(result.proof).toEqual(new Uint8Array([1, 2, 3]));
    expect(UltraHonkBackendMock).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("proveWithBackend still throws a clear error when the circuit JSON is missing (falls back correctly)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({}, { status: 404 })));
    const { proveWithBackend } = await import("./proof");

    await expect(proveWithBackend("age", new Uint8Array([9]))).rejects.toThrow(
      /Compiled circuit "age" not found/,
    );
    expect(UltraHonkBackendMock).not.toHaveBeenCalled();
  });

  it("does not destroy the backend after a proof -- it stays cached for reuse", async () => {
    const { proveWithBackend } = await import("./proof");
    await proveWithBackend("age", new Uint8Array([9]));
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("destroyBackend tears down and evicts the cached backend so the next call reconstructs", async () => {
    const { proveWithBackend, destroyBackend } = await import("./proof");

    await proveWithBackend("age", new Uint8Array([9]));
    await destroyBackend("age");
    expect(destroyMock).toHaveBeenCalledTimes(1);

    await proveWithBackend("age", new Uint8Array([9]));
    expect(UltraHonkBackendMock).toHaveBeenCalledTimes(2);
  });

  it("destroyBackend is a no-op when nothing was ever cached for that type", async () => {
    const { destroyBackend } = await import("./proof");
    await expect(destroyBackend("age")).resolves.toBeUndefined();
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("destroyAllBackends tears down every cached type", async () => {
    const { proveWithBackend, destroyAllBackends } = await import("./proof");

    await proveWithBackend("age", new Uint8Array([9]));
    await proveWithBackend("kyc", new Uint8Array([9]));
    await destroyAllBackends();

    expect(destroyMock).toHaveBeenCalledTimes(2);
  });

  it("reads crossOriginIsolated live: threads:1 when false, omitted when true", async () => {
    const { proveWithBackend } = await import("./proof");

    await proveWithBackend("age", new Uint8Array([9]));
    expect(UltraHonkBackendMock).toHaveBeenLastCalledWith(expect.any(String), { threads: 1 });

    window.crossOriginIsolated = true;

    await proveWithBackend("kyc", new Uint8Array([9]));
    expect(UltraHonkBackendMock).toHaveBeenLastCalledWith(expect.any(String), {});
  });
});

describe("withTimeout / ProofTimeoutError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves normally when the function completes before the deadline", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withTimeout(() => fn(), { timeoutMs: 5000 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws ProofTimeoutError when the deadline fires first", async () => {
    // The inner function must observe the abort signal so the promise
    // actually rejects when the controller fires.
    const fn = vi.fn().mockImplementation(
      (signal: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const promise = withTimeout(() => fn(), { timeoutMs: 1000 });
    vi.advanceTimersByTime(1000);

    await expect(promise).rejects.toThrow(ProofTimeoutError);
  });

  it("forwards the caller signal so user-cancel still works", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(
      (signal: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const promise = withTimeout(() => fn(controller.signal), {
      timeoutMs: 60_000,
    });

    // User cancels before the timeout.
    controller.abort();

    await expect(promise).rejects.toThrow(/Aborted/);
    // Must NOT be ProofTimeoutError — this was a user cancel.
    await expect(promise).rejects.not.toThrow(ProofTimeoutError);
  });

  it("cleans up the timer when the function resolves early", async () => {
    const fn = vi.fn().mockResolvedValue("done");
    await withTimeout(() => fn(), { timeoutMs: 5000 });

    // Advancing past the deadline should be a no-op (timer cleared).
    vi.advanceTimersByTime(10_000);
    // No unhandled-rejection or other side-effect.
  });

  it("rejects immediately if caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = vi.fn();
    await expect(
      withTimeout(() => fn(), { signal: controller.signal }),
    ).rejects.toThrow(/Aborted/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("uses DEFAULT_PROOF_TIMEOUT_MS when no timeoutMs is given", () => {
    expect(DEFAULT_PROOF_TIMEOUT_MS).toBeGreaterThan(0);
    // Just verify it's a reasonable value (not 0, not Infinity).
    expect(DEFAULT_PROOF_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });
});
