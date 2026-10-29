import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

const schema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(240).optional(), priceIdr: z.number().int().min(1).max(100000000), isActive: z.boolean().default(true), sortOrder: z.number().int().min(0).max(1000).default(0) });

export async function GET() {
  if (!await requireAdmin()) return jsonError("Akses admin diperlukan.", 403);
  const packages = await prisma.productPackage.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json({ packages });
}

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return jsonError("Origin tidak diizinkan.", 403);
  if (!await requireAdmin()) return jsonError("Akses admin diperlukan.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Data paket tidak valid.");
  const pkg = await prisma.productPackage.create({ data: parsed.data });
  return NextResponse.json({ package: pkg }, { status: 201 });
}
