import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { NextRequest, NextResponse } from "next/server";

const schema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(128),
});

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return jsonError("Origin tidak diizinkan.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Email atau kata sandi tidak valid.");
  const { email, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await prisma.user.create({ data: { email, passwordHash, role: UserRole.CUSTOMER } });
    await createSession({ id: user.id, email: user.email, role: user.role });
    return NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } }, { status: 201 });
  } catch {
    return jsonError("Akun dengan email tersebut sudah terdaftar.", 409);
  }
}
