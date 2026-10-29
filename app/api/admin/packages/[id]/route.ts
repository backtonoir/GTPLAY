import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

const schema = z.object({ name: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(240).nullable().optional(), priceIdr: z.number().int().min(1).max(100000000).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Origin tidak diizinkan.", 403);
  if (!await requireAdmin()) return jsonError("Akses admin diperlukan.", 403);
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Perubahan paket tidak valid.");
  try { return NextResponse.json({ package: await prisma.productPackage.update({ where: { id }, data: parsed.data }) }); }
  catch { return jsonError("Paket tidak ditemukan.", 404); }
}
