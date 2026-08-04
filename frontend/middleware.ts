import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCorsHeaders, isOriginAllowed } from "@/lib/cors";

export function middleware(request: NextRequest) {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    if (!isOriginAllowed(origin)) {
      return new NextResponse(null, { status: 204 });
    }
    return new NextResponse(null, {
      status: 204,
      headers: getCorsHeaders(),
    });
  }

  const response = NextResponse.next();
  const origin = request.headers.get("origin");
  if (isOriginAllowed(origin)) {
    const corsHeaders = getCorsHeaders();
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
