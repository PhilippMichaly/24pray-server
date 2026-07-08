/**
 * Importiert GeoNames cities500 (CC-BY 4.0, https://download.geonames.org/export/dump/)
 * in die City-Tabelle — Basis fürs Orts-Autocomplete (W3.6).
 * cities500 = alle Orte ≥ 500 EW (statt nur ≥ 15.000 wie cities15000), damit auch
 * Dörfer wie „Petershausen" (Bayern, ~7.000 EW) auffindbar sind.
 *
 *   curl -sL -o /tmp/cities500.zip https://download.geonames.org/export/dump/cities500.zip
 *   unzip -o /tmp/cities500.zip -d /tmp
 *   npm run import:cities -- /tmp/cities500.txt
 *
 * Spalten (TSV, identisch zu cities15000): 0 geonameid · 1 name · 2 asciiname ·
 * 3 alternatenames · 4 lat · 5 lon · 8 country · 14 population
 *
 * Re-Import ersetzt die Tabelle komplett (idempotent) — delete+insert laufen in EINER
 * Transaktion, damit bei ~235k Zeilen kein inkonsistenter Zwischenzustand sichtbar wird
 * und SQLite nicht pro Chunk fsynct (das drückte die Laufzeit von ~31s auf ~13s).
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createPrisma } from '../src/db.js';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: import-cities <pfad/zu/cities500.txt>');
    process.exit(1);
  }
  const prisma = createPrisma(process.env.DATABASE_URL);

  const rows: {
    id: number; name: string; country: string; lat: number; lon: number;
    population: number; search: string;
  }[] = [];

  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line.split('\t');
    if (c.length < 15) continue;
    const id = Number(c[0]);
    const name = c[1];
    const lat = Number(c[4]);
    const lon = Number(c[5]);
    const population = Number(c[14]) || 0;
    if (!id || !name || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    // Suchblob: Name + ASCII + alle Sprachvarianten, lowercase („münchen" findet Munich)
    const search = `${c[1]},${c[2]},${c[3]}`.toLowerCase();
    rows.push({ id, name, country: c[8] ?? '', lat, lon, population, search });
  }

  console.log(`${rows.length} Städte geparst — importiere …`);
  const CHUNK = 5000;
  await prisma.$transaction(async (tx) => {
    await tx.city.deleteMany();
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.city.createMany({ data: rows.slice(i, i + CHUNK) });
    }
  }, { timeout: 120_000 });
  // city_fts (FTS5-Präfix-Index für /geocode, Migration 20260708140000_add_city_fts_search)
  // bleibt über Trigger auf City automatisch synchron — auch für deleteMany/createMany oben.
  // Nach ~235k einzelnen Trigger-Inserts 'optimize' fahren: merged die vielen kleinen
  // FTS-B-Tree-Segmente zu einem kompakten Index (hält Query-Latenz niedrig).
  await prisma.$executeRawUnsafe(`INSERT INTO "city_fts"("city_fts") VALUES('optimize')`);
  const n = await prisma.city.count();
  console.log(`Fertig: ${n} Städte in der City-Tabelle (FTS5-Index optimiert).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
