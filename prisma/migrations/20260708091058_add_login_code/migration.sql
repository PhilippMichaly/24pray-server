-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MagicToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "code" TEXT,
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MagicToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MagicToken" ("consumedAt", "createdAt", "expiresAt", "id", "token", "userId") SELECT "consumedAt", "createdAt", "expiresAt", "id", "token", "userId" FROM "MagicToken";
DROP TABLE "MagicToken";
ALTER TABLE "new_MagicToken" RENAME TO "MagicToken";
CREATE UNIQUE INDEX "MagicToken_token_key" ON "MagicToken"("token");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
