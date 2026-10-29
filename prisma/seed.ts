import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (minimum 12 characters) before seeding.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: UserRole.ADMIN },
    create: { email, passwordHash, role: UserRole.ADMIN },
  });

  const packageCount = await prisma.productPackage.count();
  if (packageCount === 0) {
    await prisma.productPackage.createMany({
      data: [
        { name: "Starter Pack", description: "Paket pemula", priceIdr: 15000, sortOrder: 1 },
        { name: "Builder Pack", description: "Paket populer", priceIdr: 35000, sortOrder: 2 },
        { name: "Pro Pack", description: "Paket pilihan", priceIdr: 75000, sortOrder: 3 },
      ],
    });
  }

  const announcementCount = await prisma.announcement.count();
  if (announcementCount === 0) {
    await prisma.announcement.create({
      data: {
        title: "Selamat datang di GrowTop",
        body: "Pesanan akan diproses manual oleh admin setelah pembayaran dikonfirmasi.",
        isPublished: true,
        publishedAt: new Date(),
      },
    });
  }
}

main().finally(async () => prisma.$disconnect());
