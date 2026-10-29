import { randomBytes } from "node:crypto";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

const schema = z.object({
  packageId: z.string().min(1),
  growId: z.string().trim().min(2).max(24).regex(/^[a-zA-Z0-9_]+$/),
  customerEmail: z.email().transform((value) => value.trim().toLowerCase()),
  paymentMethod: z.enum(["QRIS", "E-Wallet", "Virtual Account", "Transfer Bank"]).optional(),
});

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return jsonError("Origin tidak diizinkan.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Periksa kembali paket, GrowID, dan email.");
  const product = await prisma.productPackage.findFirst({ where: { id: parsed.data.packageId, isActive: true } });
  if (!product) return jsonError("Paket tidak tersedia.", 404);
  const session = await getSession();
  const orderCode = `GT-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
  const order = await prisma.order.create({
    data: {
      orderCode,
      userId: session?.id,
      packageId: product.id,
      packageName: product.name,
      amountIdr: product.priceIdr,
      growId: parsed.data.growId,
      customerEmail: parsed.data.customerEmail,
      paymentMethod: parsed.data.paymentMethod,
      status: "PENDING_PAYMENT",
      events: { create: { to: "PENDING_PAYMENT", note: "Pesanan dibuat." } },
    },
    select: { orderCode: true, packageName: true, amountIdr: true, growId: true, status: true, createdAt: true },
  });
  return NextResponse.json({ order }, { status: 201 });
}
