/**
 * Re-exports of the OpenAPI-generated types (types/api.d.ts) under ergonomic
 * names used throughout the codebase.
 *
 * Do NOT edit by hand — the canonical definitions live in docs/openapi.yaml.
 * Run `pnpm generate-types` to regenerate types/api.d.ts.
 */

import type { components, operations } from "./api.js";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export type { components, operations };

export type CredentialType = components["schemas"]["CredentialType"];
export type ClaimParams = components["schemas"]["ClaimParams"];
export type Credential = components["schemas"]["Credential"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type DependencyStatus = components["schemas"]["DependencyStatus"];
export type SignerStatus = components["schemas"]["SignerStatus"];
export type ReadyResponse = components["schemas"]["ReadyResponse"];
export type RegisteredIssuer = components["schemas"]["RegisteredIssuer"];
export type PlaidBalanceMockResponse =
  components["schemas"]["PlaidBalanceMockResponse"];
export type PlaidBalanceRealResponse =
  components["schemas"]["PlaidBalanceRealResponse"];
export type PlaidBalanceResponse =
  | PlaidBalanceMockResponse
  | PlaidBalanceRealResponse;

// ---------------------------------------------------------------------------
// Request / response shapes per operation
// ---------------------------------------------------------------------------

/** Request body for POST /api/issue */
export type IssueRequest =
  operations["issueCredentials"]["requestBody"]["content"]["application/json"];

/** 200 response body for POST /api/issue */
export type IssueResponse200 =
  operations["issueCredentials"]["responses"][200]["content"]["application/json"];

/** 202 response body for POST /api/issue (Persona redirect required) */
export type IssueResponse202 =
  operations["issueCredentials"]["responses"][202]["content"]["application/json"];

/** Request body for POST /api/witness */
export type WitnessRequest =
  operations["generateWitness"]["requestBody"]["content"]["application/json"];

/** 200 response body for POST /api/witness */
export type WitnessResponse200 =
  operations["generateWitness"]["responses"][200]["content"]["application/json"];
