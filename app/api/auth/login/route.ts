import bcrypt from "bcryptjs";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { createSession } from "@/lib/session";

const schema = z.object({ email: z.email().transform((value) => value.trim().toLowerCase()), password: z.string().min(1).max(128) });

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return jsonError("Origin tidak diizinkan.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Email atau kata sandi salah.", 401);
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const valid = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
  if (!user || !valid) return jsonError("Email atau kata sandi salah.", 401);
  await createSession({ id: user.id, email: user.email, role: user.role });
  return NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } });
}
