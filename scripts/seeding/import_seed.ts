/**
 * Script de préparation et d'injection par batch pour Cloudflare D1
 * Traite les exports/scrapes de BDthèque et BDvore
 * Usage: npx ts-node scripts/seeding/import_seed.ts <input_file.json>
 */

import * as fs from 'fs';
import * as path from 'path';

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
  const statements: string[] = [];
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

console.log('Utilitaire de génération de seed SQL initialisé.');
