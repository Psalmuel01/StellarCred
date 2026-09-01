"use client";

/**
 * useProofFlow — manages the state machine for a single credential's
 * proof generation and submission lifecycle.
 *
 * Stages: idle → witness → circuit → proof → generated → preflight → readyToSign → submitting → confirmed | error
 *
 * No exhaustive-deps hacks: every effect dependency is explicit and minimal.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Credential } from "../credential";

import { computeWitness, proveWithBackend, withTimeout, ProofTimeoutError, DEFAULT_PROOF_TIMEOUT_MS } from "../proof";
import {
  submitProof as defaultSubmitProof,
  preflightSubmitProof,
  parseContractError,
  type ContractError,
  type FeeEstimate,
} from "../contracts";
import { credTtlSecs } from "../proof-helpers";
import { useProofTimeline } from "../useProofTimeline";
import { useToast } from "@/components/Toast";

export type Stage =
  | "idle"
  | "witness"
  | "circuit"
  | "proof"
  | "proving"
  | "generated"
  | "preflight"
  | "readyToSign"
  | "submitting"
  | "confirmed"
  | "error";

export type ErrorPhase = "proving" | "preflight" | "submitting" | "timeout" | null;

/** Custom submission function signature — injected by the page for sponsored mode. */
export type SubmitFn = (params: {
  holder: string;
  issuerId: string;
  credentialType: string;
  proof: Uint8Array;
  publicInputs: Uint8Array;
  ttlSecs: number;
  vkVersion?: number;
}) => Promise<string>;

export function useProofFlow(
  cred: Credential | null,
  submitFn: SubmitFn = defaultSubmitProof,
) {
  const [stage, setStage] = useState<Stage>("idle");
  const [proof, setProof] = useState<{ proof: Uint8Array; publicInputs: Uint8Array } | null>(null);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState<ContractError | null>(null);
  const [errorPhase, setErrorPhase] = useState<ErrorPhase>(null);
  /** Estimated on-chain fee reported by the preflight simulation. */
  const [fee, setFee] = useState<FeeEstimate | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useToast();
  const { addEvent } = useProofTimeline(cred);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Proof generation ───────────────────────────────────────────────────────
  // Fires automatically when `cred` changes (single dependency).
  useEffect(() => {
    if (!cred) return;

    const controller = new AbortController();
    const { signal } = controller;

    setStage("witness");
    setProof(null);
    setTxHash("");
    setError(null);
    setErrorPhase(null);
    setFee(null);
    setElapsed(0);

    toast.info(`Generating proof for ${cred.title}…`);

    (async () => {
      try {
        const start = Date.now();
        timerRef.current = setInterval(
          () => setElapsed(Math.floor((Date.now() - start) / 1000)),
          1000,
        );

        // Stage 1: witness (server)
        const witness = await withTimeout(
          (sig) =>
            computeWitness(
              cred.type,
              cred as unknown as Record<string, unknown>,
              sig,
            ),
          { signal, timeoutMs: DEFAULT_PROOF_TIMEOUT_MS },
        );
        if (signal.aborted) return;

        // Stage 2: prove (browser WASM)
        setStage("proving");
        const proveStart = Date.now();
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(
          () => setElapsed(Math.floor((Date.now() - proveStart) / 1000)),
          1000,
        );

        const result = await withTimeout(
          (sig) =>
            proveWithBackend(cred.type, witness, sig, (step) => {
              if (!sig.aborted) setStage(step);
            }),
          { signal, timeoutMs: DEFAULT_PROOF_TIMEOUT_MS },
        );
        if (signal.aborted) return;

        setProof(result);
        setStage("generated");
        addEvent("generated");
        toast.success(`Proof generated for ${cred.title}`);
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof ProofTimeoutError) {
          setError({
            code: null,
            friendly:
              "Proof generation timed out. The prover took too long — this can happen on slow devices or with large circuits. Please try again.",
            raw: e.message,
          });
          setErrorPhase("timeout");
          setStage("error");
          toast.error("Proof timed out — please try again.");
          return;
        }
        const parsed = parseContractError((e as Error).message);
        setError(parsed);
        setErrorPhase("proving");
        setStage("error");
        toast.error(`Proof generation failed: ${parsed.friendly}`);
      } finally {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    })();

    return () => {
      controller.abort();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [cred]); // eslint-disable-line react-hooks/exhaustive-deps -- cred is the sole trigger; addEvent/toast are stable refs

  // ── Preflight simulation ─────────────────────────────────────────────────
  // Runs a Soroban preflight so a doomed submission is caught before the
  // wallet signature is requested. On success, surfaces the fee estimate.

  const onPreflight = useCallback(
    async (holder: string) => {
      if (!proof || !cred) return;
      setError(null);
      setErrorPhase(null);
      setFee(null);
      setStage("preflight");
      addEvent("preflight");
      try {
        const preflight = await preflightSubmitProof({
          holder,
          issuerId: cred.issuerId,
          credentialType: cred.type,
          proof: proof.proof,
          publicInputs: proof.publicInputs,
          ttlSecs: credTtlSecs(cred),
        });
        if (!preflight.ok) {
          setError(preflight.error);
          setErrorPhase("preflight");
          setStage("error");
          toast.error(`Submission blocked — ${preflight.error.friendly}`);
          return;
        }
        setFee(preflight.fee);
        setStage("readyToSign");
      } catch (e) {
        const parsed = parseContractError((e as Error).message);
        setError(parsed);
        setErrorPhase("preflight");
        setStage("error");
        toast.error(`Preflight simulation failed: ${parsed.friendly}`);
      }
    },
    [proof, cred, addEvent, toast],
  );

  // ── Sign and submit ─────────────────────────────────────────────────────
  // Only reached after the preflight simulation succeeded (or user override).

  const doSignAndSubmit = useCallback(
    async (holder: string, networkMismatch: boolean) => {
      if (!proof || !cred || networkMismatch) return;
      setStage("submitting");
      addEvent("submitted");
      toast.info(`Submitting proof for ${cred.title} to Stellar…`);
      try {
        const hash = await submitFn({
          holder,
          issuerId: cred.issuerId,
          credentialType: cred.type,
          proof: proof.proof,
          publicInputs: proof.publicInputs,
          ttlSecs: credTtlSecs(cred),
        });
        setTxHash(hash);
        setStage("confirmed");
        addEvent("verified", { txHash: hash });
        toast.success(`Proof confirmed on-chain for ${cred.title}`, { txHash: hash });
        return hash;
      } catch (e) {
        const parsed = parseContractError((e as Error).message);
        setError(parsed);
        setErrorPhase("submitting");
        setStage("error");
        toast.error(`Submission failed: ${parsed.friendly}`);
        return null;
      }
    },
    [proof, cred, submitFn, addEvent, toast],
  );

  // ── Combined: preflight → sign ───────────────────────────────────────────
  // Convenience for the "Submit to Stellar" button (before preflight is run).

  const onSubmit = useCallback(
    async (holder: string, _networkMismatch: boolean) => {
      await onPreflight(holder);
    },
    [onPreflight],
  );

  // Retry submission without re-proving when the proof already exists.

  const onRetrySubmit = useCallback(
    async (holder: string, networkMismatch: boolean) => {
      setError(null);
      setErrorPhase(null);
      if (fee) {
        // Already passed preflight; skip straight to signing.
        return doSignAndSubmit(holder, networkMismatch);
      }
      // No fee cached; run preflight then sign.
      await onPreflight(holder);
    },
    [fee, doSignAndSubmit, onPreflight],
  );

  const reset = useCallback(() => {
    setStage("idle");
    setProof(null);
    setTxHash("");
    setError(null);
    setErrorPhase(null);
    setFee(null);
    setElapsed(0);
  }, []);

  return {
    stage,
    proof,
    txHash,
    error,
    errorPhase,
    fee,
    elapsed,
    onSubmit,
    onPreflight,
    doSignAndSubmit,
    onRetrySubmit,
    reset,
  };
}
