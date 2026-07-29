import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Serve the raw OpenAPI spec as JSON (for tooling consumption).
export async function GET() {
  const specPath = join(process.cwd(), "..", "docs", "openapi.yaml");
  let specYaml: string;
  try {
    specYaml = readFileSync(specPath, "utf-8");
  } catch {
    return NextResponse.json({ error: "OpenAPI spec not found" }, { status: 404 });
  }

  // Serve the Redoc HTML page — loads spec from /api/docs/spec.yaml
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>StellarCred API Reference</title>
    <!-- Redoc standalone bundle (no React dependency needed) -->
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <redoc spec-url="/api/docs/spec"></redoc>
    <script>
      Redoc.init('/api/docs/spec', {
        theme: {
          colors: { primary: { main: '#4f46e5' } },
          typography: { fontFamily: 'Inter, system-ui, sans-serif' }
        }
      });
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
