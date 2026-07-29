import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Serves the raw OpenAPI spec as YAML at GET /api/docs/spec.
 * Used by the Redoc page at /api/docs to load the spec.
 * Also useful for tooling (e.g. `openapi-typescript`, Postman import).
 */
export async function GET() {
  const specPath = join(process.cwd(), "..", "docs", "openapi.yaml");
  let specYaml: string;
  try {
    specYaml = readFileSync(specPath, "utf-8");
  } catch {
    return NextResponse.json({ error: "OpenAPI spec not found" }, { status: 404 });
  }

  return new NextResponse(specYaml, {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      // Allow cross-origin fetch so browser-based tooling can consume it.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
