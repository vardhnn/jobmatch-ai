import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

// Job sources are created by the app itself (src/lib/sources registry) — the
// search service self-heals the rows on first run, so the seed stays source
// agnostic and never hard-codes a board list.

async function main() {
  const email = (process.env.SEED_USER_EMAIL ?? "you@example.com").toLowerCase();
  const password = process.env.SEED_USER_PASSWORD ?? "jobmatch-dev-password";

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: hashPassword(password), name: null },
  });

  await prisma.candidateProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  await prisma.jobPreferences.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  console.log(`Seeded user: ${email}`);
  console.log(`Dev source enabled. Login with the password from SEED_USER_PASSWORD.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
