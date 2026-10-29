import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  if (!await requireAdmin()) return jsonError("Akses admin diperlukan.", 403);
  const status = request.nextUrl.searchParams.get("status");
  const allowed = ["PENDING_PAYMENT", "PAID", "PROCESSING", "COMPLETED", "CANCELLED"];
  const orders = await prisma.order.findMany({
    where: status && allowed.includes(status) ? { status: status as never } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { events: { orderBy: { createdAt: "desc" }, take: 5, include: { actor: { select: { email: true } } } } },
  });
  return NextResponse.json({ orders });
}
