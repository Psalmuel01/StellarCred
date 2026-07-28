import { NextRequest, NextResponse } from "next/server";
import { getPersonaResult } from "@/lib/persona-cache";

export const dynamic = "force-dynamic";

// Polled by /verify after the holder returns from Persona's hosted flow.
// The actual issuance happens out-of-band in app/api/persona/webhook once
// Persona's async decisioning completes — this just checks whether that has
// landed in the result cache yet.
export async function GET(req: NextRequest) {
  const inquiryId = req.nextUrl.searchParams.get("inquiry_id");
  if (!inquiryId) {
    return NextResponse.json({ error: "inquiry_id is required" }, { status: 400 });
  }

  const credentials = getPersonaResult(inquiryId);
  if (!credentials) {
    return NextResponse.json({ ready: false }, { status: 202 });
  }
  return NextResponse.json({ ready: true, credentials });
}
