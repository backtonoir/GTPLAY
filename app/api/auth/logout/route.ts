import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/session";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return jsonError("Origin tidak diizinkan.", 403);
  await clearSession();
  return NextResponse.json({ ok: true });
}
