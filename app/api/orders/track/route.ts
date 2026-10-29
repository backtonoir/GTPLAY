import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/http";

const schema = z.object({ orderCode: z.string().min(5).max(40), email: z.email().transform((value) => value.trim().toLowerCase()) });

export async function GET(request: NextRequest) {
  const parsed = schema.safeParse({ orderCode: request.nextUrl.searchParams.get("orderCode"), email: request.nextUrl.searchParams.get("email") });
  if (!parsed.success) return jsonError("Masukkan nomor pesanan dan email yang valid.");
  const order = await prisma.order.findFirst({
    where: { orderCode: parsed.data.orderCode, customerEmail: parsed.data.email },
    select: { orderCode: true, packageName: true, amountIdr: true, status: true, createdAt: true, updatedAt: true },
  });
  if (!order) return jsonError("Pesanan tidak ditemukan.", 404);
  return NextResponse.json({ order });
}
