-- Erster erfolgreicher Login je Konto (Betreiber-Benachrichtigung „neues Konto").
ALTER TABLE "User" ADD COLUMN "activatedAt" DATETIME;

-- Bestandsnutzer gelten als bereits aktiviert. Ohne dieses Backfill würde der jeweils
-- erste Login NACH dem Deploy für jeden Altnutzer eine „neues Konto"-Mail auslösen.
-- Nebenwirkung, bewusst in Kauf genommen: Adressen, die nur einen Magic-Link angefordert
-- aber nie eingelöst haben, gelten damit ebenfalls als aktiviert und melden sich nie.
-- Der umgekehrte Fehler (Postfach des Betreibers voller Fehlalarme) wiegt schwerer.
UPDATE "User" SET "activatedAt" = "createdAt";
