/**
 * Importiert GeoNames cities15000 (CC-BY 4.0, https://download.geonames.org/export/dump/)
 * in die City-Tabelle — Basis fürs Orts-Autocomplete (W3.6).
 *
 *   curl -sL -o /tmp/cities15000.zip https://download.geonames.org/export/dump/cities15000.zip
 *   unzip -o /tmp/cities15000.zip -d /tmp
 *   npm run import:cities -- /tmp/cities15000.txt
 *
 * Spalten (TSV): 0 geonameid · 1 name · 2 asciiname · 3 alternatenames ·
 * 4 lat · 5 lon · 8 country · 14 population
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createPrisma } from '../src/db.js';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: import-cities <pfad/zu/cities15000.txt>');
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
  await prisma.city.deleteMany();
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.city.createMany({ data: rows.slice(i, i + CHUNK) });
  }
  const n = await prisma.city.count();
  console.log(`Fertig: ${n} Städte in der City-Tabelle.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
