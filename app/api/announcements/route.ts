import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const announcements = await prisma.announcement.findMany({ where: { isPublished: true }, orderBy: { publishedAt: "desc" }, take: 10, select: { id: true, title: true, body: true, publishedAt: true } });
  return NextResponse.json({ announcements });
}
