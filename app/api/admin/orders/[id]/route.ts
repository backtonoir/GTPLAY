import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

const schema = z.object({ status: z.enum(["PENDING_PAYMENT", "PAID", "PROCESSING", "COMPLETED", "CANCELLED"]), adminNotes: z.string().trim().max(1000).optional() });
const transitions: Record<string, string[]> = {
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Origin tidak diizinkan.", 403);
  const admin = await requireAdmin();
  if (!admin) return jsonError("Akses admin diperlukan.", 403);
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Data perubahan status tidak valid.");
  const current = await prisma.order.findUnique({ where: { id } });
  if (!current) return jsonError("Pesanan tidak ditemukan.", 404);
  if (!transitions[current.status].includes(parsed.data.status)) return jsonError(`Perubahan ${current.status} ke ${parsed.data.status} tidak diizinkan.`, 409);

  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id },
      data: {
        status: parsed.data.status,
        adminNotes: parsed.data.adminNotes,
        ...(parsed.data.status === "PAID" ? { confirmedPaidAt: new Date() } : {}),
        ...(parsed.data.status === "COMPLETED" ? { completedAt: new Date() } : {}),
      },
    });
    await tx.orderEvent.create({ data: { orderId: id, actorId: admin.id, from: current.status, to: order.status, note: parsed.data.adminNotes || null } });
    return order;
  });
  return NextResponse.json({ order: updated });
}
