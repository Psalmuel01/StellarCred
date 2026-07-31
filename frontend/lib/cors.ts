const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";

function getAllowedOrigin(): string {
  const configured = process.env.APP_ORIGIN;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return "";
  return "http://localhost:3000";
}

export function getCorsHeaders(): Record<string, string> {
  const origin = getAllowedOrigin();
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    Vary: "Origin",
  };
}

export function isOriginAllowed(requestOrigin: string | null): boolean {
  if (!requestOrigin) return false;
  const allowed = getAllowedOrigin();
  if (!allowed) return false;
  return requestOrigin === allowed;
}
