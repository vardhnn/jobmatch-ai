-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SearchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "totalFound" INTEGER NOT NULL DEFAULT 0,
    "newJobs" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "strongMatches" INTEGER NOT NULL DEFAULT 0,
    "potentialMatches" INTEGER NOT NULL DEFAULT 0,
    "lowMatches" INTEGER NOT NULL DEFAULT 0,
    "sourcesTried" INTEGER NOT NULL DEFAULT 0,
    "analyzed" INTEGER NOT NULL DEFAULT 0,
    "sourceErrors" TEXT NOT NULL DEFAULT '[]',
    "sourceNotes" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "SearchRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SearchRun" ("duplicates", "error", "finishedAt", "id", "lowMatches", "newJobs", "potentialMatches", "sourceErrors", "startedAt", "status", "strongMatches", "totalFound", "trigger", "userId") SELECT "duplicates", "error", "finishedAt", "id", "lowMatches", "newJobs", "potentialMatches", "sourceErrors", "startedAt", "status", "strongMatches", "totalFound", "trigger", "userId" FROM "SearchRun";
DROP TABLE "SearchRun";
ALTER TABLE "new_SearchRun" RENAME TO "SearchRun";
CREATE INDEX "SearchRun_userId_idx" ON "SearchRun"("userId");
CREATE INDEX "SearchRun_startedAt_idx" ON "SearchRun"("startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
