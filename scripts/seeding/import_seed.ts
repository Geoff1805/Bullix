/**
 * Script de préparation et d'injection par batch pour Cloudflare D1
 * Traite les exports/scrapes de BDthèque et BDvore
 * Usage: npx ts-node scripts/seeding/import_seed.ts <input_file.json>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';

interface ScrapedSeries {
  id: string;
  title: string;
  type: 'Franco-belge' | 'Manga' | 'Comics' | 'Autre';
  status: 'En cours' | 'Terminée' | 'Abandonnée' | 'Inconnue';
  total_volumes: number | null;
  publisher_default: string | null;
  albums: ScrapedAlbum[];
}

interface ScrapedAlbum {
  id: string;
  volume_number: number;
  title: string;
  isbn: string | null;
  upc: string | null;
  authors: string | null;
  publisher: string | null;
  published_year: number | null;
  cover_image_url: string | null;
}

export function generateSqlBatch(seriesList: ScrapedSeries[]): string {
  const statements: string[] = [
    `CREATE TABLE IF NOT EXISTS series (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('Franco-belge', 'Manga', 'Comics', 'Autre')) DEFAULT 'Franco-belge',
    status TEXT CHECK(status IN ('En cours', 'Terminée', 'Abandonnée', 'Inconnue')) DEFAULT 'En cours',
    total_volumes INTEGER DEFAULT NULL,
    publisher_default TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL
);`,
    `CREATE INDEX IF NOT EXISTS idx_series_title ON series(title);`,
    `CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY NOT NULL,
    series_id TEXT NOT NULL,
    volume_number REAL NOT NULL,
    title TEXT,
    isbn TEXT,
    upc TEXT,
    authors TEXT,
    publisher TEXT,
    published_year INTEGER,
    cover_image_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL,
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
);`,
    `CREATE INDEX IF NOT EXISTS idx_albums_isbn ON albums(isbn);`,
    `CREATE INDEX IF NOT EXISTS idx_albums_series_id ON albums(series_id, volume_number);`
  ];
  const now = Date.now();

  for (const s of seriesList) {
    const escapedTitle = s.title.replace(/'/g, "''");
    const escapedPublisher = s.publisher_default ? `'${s.publisher_default.replace(/'/g, "''")}'` : 'NULL';
    const totalVolumes = s.total_volumes !== null ? s.total_volumes : 'NULL';

    statements.push(`
INSERT OR IGNORE INTO series (id, title, type, status, total_volumes, publisher_default, created_at, updated_at)
VALUES ('${s.id}', '${escapedTitle}', '${s.type}', '${s.status}', ${totalVolumes}, ${escapedPublisher}, ${now}, ${now});
    `.trim());

    for (const a of s.albums) {
      const cleanIsbn = a.isbn ? `'${a.isbn.replace(/[-\s]/g, '')}'` : 'NULL';
      const cleanUpc = a.upc ? `'${a.upc.replace(/[-\s]/g, '')}'` : 'NULL';
      const albumTitle = a.title ? `'${a.title.replace(/'/g, "''")}'` : 'NULL';
      const authors = a.authors ? `'${a.authors.replace(/'/g, "''")}'` : 'NULL';
      const publisher = a.publisher ? `'${a.publisher.replace(/'/g, "''")}'` : 'NULL';
      const year = a.published_year !== null ? a.published_year : 'NULL';
      const cover = a.cover_image_url ? `'${a.cover_image_url.replace(/'/g, "''")}'` : 'NULL';

      statements.push(`
INSERT OR IGNORE INTO albums (id, series_id, volume_number, title, isbn, upc, authors, publisher, published_year, cover_image_url, created_at, updated_at)
VALUES ('${a.id}', '${s.id}', ${a.volume_number}, ${albumTitle}, ${cleanIsbn}, ${cleanUpc}, ${authors}, ${publisher}, ${year}, ${cover}, ${now}, ${now});
      `.trim());
    }
  }

  return statements.join('\n');
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('import_seed')) {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3];

  if (!inputFile) {
    console.log(`
[Bullix Seeder] Usage:
  npx tsx scripts/seeding/import_seed.ts <input_file.json> [output_file.sql]

Exemple:
  npx tsx scripts/seeding/import_seed.ts scripts/seeding/sample_scraped_data.json scripts/seeding/generated_seed.sql
    `);
  } else {
    try {
      const fullInputPath = path.resolve(process.cwd(), inputFile);
      if (!fs.existsSync(fullInputPath)) {
        console.error(`❌ Erreur: Fichier introuvable: ${fullInputPath}`);
        process.exit(1);
      }
      const rawData = fs.readFileSync(fullInputPath, 'utf-8');
      const seriesList: ScrapedSeries[] = JSON.parse(rawData);
      const sqlBatch = generateSqlBatch(seriesList);

      if (outputFile) {
        const fullOutputPath = path.resolve(process.cwd(), outputFile);
        fs.writeFileSync(fullOutputPath, sqlBatch, 'utf-8');
        console.log(`✅ Succès: ${seriesList.length} série(s) convertie(s) en SQL dans ${fullOutputPath}`);
      } else {
        console.log(sqlBatch);
      }
    } catch (err: any) {
      console.error(`❌ Erreur lors du traitement: ${err.message}`);
      process.exit(1);
    }
  }
}
