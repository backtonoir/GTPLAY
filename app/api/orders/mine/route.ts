import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { jsonError } from "@/lib/http";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Silakan masuk untuk melihat riwayat.", 401);
  const orders = await prisma.order.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: "desc" },
    select: { orderCode: true, packageName: true, amountIdr: true, growId: true, status: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ orders });
}
