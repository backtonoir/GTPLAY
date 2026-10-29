import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

const schema = z.object({ title: z.string().trim().min(3).max(120).optional(), body: z.string().trim().min(3).max(2000).optional(), isPublished: z.boolean().optional() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Origin tidak diizinkan.", 403);
  if (!await requireAdmin()) return jsonError("Akses admin diperlukan.", 403);
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Perubahan pengumuman tidak valid.");
  const data = { ...parsed.data, ...(parsed.data.isPublished === undefined ? {} : { publishedAt: parsed.data.isPublished ? new Date() : null }) };
  try { return NextResponse.json({ announcement: await prisma.announcement.update({ where: { id }, data }) }); }
  catch { return jsonError("Pengumuman tidak ditemukan.", 404); }
}
