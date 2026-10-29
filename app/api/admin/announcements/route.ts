import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

const schema = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(2000), isPublished: z.boolean().default(false) });

export async function GET() {
  if (!await requireAdmin()) return jsonError("Akses admin diperlukan.", 403);
  const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ announcements });
}

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return jsonError("Origin tidak diizinkan.", 403);
  if (!await requireAdmin()) return jsonError("Akses admin diperlukan.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Data pengumuman tidak valid.");
  const announcement = await prisma.announcement.create({ data: { ...parsed.data, publishedAt: parsed.data.isPublished ? new Date() : null } });
  return NextResponse.json({ announcement }, { status: 201 });
}
