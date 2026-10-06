/**
 * Side-effect module: loads `.env` into `process.env`.
 *
 * Import this FIRST in any script that reads `src/lib/config` — config
 * evaluates `process.env` at module load, so the file has to be read before the
 * config import is evaluated. Static `import` statements are hoisted but run in
 * source order, so `import "./load-env"` above the config import is enough.
 *
 * (The Next.js server gets `.env` for free from its own runtime; Prisma's
 * client also auto-loads it, which is why `npm run verify` worked before this
 * module existed.)
 */

import path from "path";

try {
  process.loadEnvFile(path.resolve(process.cwd(), ".env"));
} catch {
  // No `.env` on disk (CI, containers) — assume the environment is populated.
}
