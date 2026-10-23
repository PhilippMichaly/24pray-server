-- AlterTable (A11a): gewünschte UI-Sprache wandert mit dem Token und greift erst beim Einlösen
ALTER TABLE "MagicToken" ADD COLUMN "locale" TEXT;
