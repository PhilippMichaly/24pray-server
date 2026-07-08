-- Rare-Name-Latenz-Fix (W3.6b): FTS5-Präfix-Index über City.name/City.search.
-- Ohne diesen Index muss SQLite bei seltenen Namen (z.B. "petershausen") fast die
-- gesamte City-Tabelle in Populations-Reihenfolge scannen (~220ms), weil der
-- population-Index keine Filterung nach Namen kennt. FTS5 löst "term*"-Präfixsuchen
-- über einen invertierten Index in <1ms auf, unabhängig von der Trefferzahl.
--
-- external-content-Tabelle (kein eigener Datenspeicher, referenziert City per rowid)
-- + Trigger, damit JEDER Schreibweg — Import-Skript (createMany) UND Test-Fixtures
-- (ebenfalls createMany) — automatisch synchron bleibt, ohne dass Aufrufer an einen
-- manuellen Rebuild denken müssen. Der Import-Rebuild (scripts/import-cities.ts) ruft
-- zusätzlich 'optimize' nach dem Bulk-Import, um die vielen kleinen Trigger-Segmente
-- zu einem kompakten Index zusammenzuführen.
CREATE VIRTUAL TABLE "city_fts" USING fts5(
  "name",
  "search",
  content='City',
  content_rowid='id'
);

-- Backfill für bereits vorhandene Zeilen (bei einer frischen DB ein No-Op).
INSERT INTO "city_fts"("rowid", "name", "search") SELECT "id", "name", "search" FROM "City";

CREATE TRIGGER "city_fts_ai" AFTER INSERT ON "City" BEGIN
  INSERT INTO "city_fts"("rowid", "name", "search") VALUES (new."id", new."name", new."search");
END;

CREATE TRIGGER "city_fts_ad" AFTER DELETE ON "City" BEGIN
  INSERT INTO "city_fts"("city_fts", "rowid", "name", "search") VALUES('delete', old."id", old."name", old."search");
END;

CREATE TRIGGER "city_fts_au" AFTER UPDATE ON "City" BEGIN
  INSERT INTO "city_fts"("city_fts", "rowid", "name", "search") VALUES('delete', old."id", old."name", old."search");
  INSERT INTO "city_fts"("rowid", "name", "search") VALUES (new."id", new."name", new."search");
END;
