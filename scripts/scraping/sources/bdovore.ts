/**
 * Scraper & Importateur pour BDovore (bdvore.com / bdovore.com)
 * Gère le scraping direct avec protection Turnstile/Cloudflare tolérante,
 * et le parsing d'exports CSV / JSON natifs de collections BDovore.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ScrapedSeries, ScrapedAlbum, SeriesType, SeriesStatus } from '../types.ts';
import { fetchWithRetry } from '../utils/rate_limiter.ts';
import { cleanIsbn, cleanText, inferSeriesType } from '../utils/normalizer.ts';

const BDOVORE_BASE = 'https://www.bdovore.com';

/**
 * Tente de scraper une série directement sur BDovore
 */
export async function fetchBdovoreSeries(seriesId: number, slug: string): Promise<ScrapedSeries | null> {
  const url = `${BDOVORE_BASE}/serie-bd-${seriesId}-${slug}`;
  try {
    const res = await fetchWithRetry(url, {}, 2, 1000);
    if (res.status === 403 || res.status === 503) {
      console.warn(`[BDovore] Accès restreint par Cloudflare Turnstile pour ${url}. Utilisation du fallback/export.`);
      return null;
    }
    if (!res.ok) {
      return null;
    }

    const html = await res.text();
    if (html.includes('Enable JavaScript and cookies to continue') || html.includes('_cf_chl_opt')) {
      console.warn(`[BDovore] Défi Cloudflare détecté sur ${url}. Requête ignorée gracieusement.`);
      return null;
    }

    // Parsing HTML si la page est directement accessible
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const title = titleMatch ? cleanText(titleMatch[1]) : cleanText(slug.replace(/-/g, ' '));

    return {
      id: `series_bdv_${seriesId}`,
      title: title,
      type: inferSeriesType(title),
      status: 'En cours',
      total_volumes: null,
      publisher_default: null,
      albums: []
    };
  } catch (err: any) {
    console.warn(`[BDovore] Échec scraping web pour ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Parse un fichier d'export CSV provenant de BDovore
 */
export function parseBdovoreCsv(filePath: string): ScrapedSeries[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`[BDovore] Fichier CSV introuvable: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(/[;,]/).map(h => h.trim().toLowerCase());
  const seriesMap = new Map<string, ScrapedSeries>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/[;,]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 2) continue;

    // Détection des colonnes
    const seriesTitle = cols[0] || 'Série Inconnue';
    const albumTitle = cols[1] || '';
    const volumeRaw = cols[2] ? parseFloat(cols[2]) : 1;
    const volumeNumber = isNaN(volumeRaw) ? 1 : volumeRaw;
    const isbn = cleanIsbn(cols[3] || null);
    const publisher = cols[4] || null;
    const yearRaw = cols[5] ? parseInt(cols[5], 10) : null;
    const publishedYear = isNaN(yearRaw as number) ? null : yearRaw;

    const seriesKey = seriesTitle.toLowerCase();
    let series = seriesMap.get(seriesKey);
    if (!series) {
      series = {
        id: `series_bdv_csv_${seriesMap.size + 1}`,
        title: cleanText(seriesTitle),
        type: inferSeriesType(seriesTitle),
        status: 'En cours',
        total_volumes: 0,
        publisher_default: publisher,
        albums: []
      };
      seriesMap.set(seriesKey, series);
    }

    series.albums.push({
      id: `alb_bdv_csv_${series.id}_${Math.round(volumeNumber * 10)}`,
      volume_number: volumeNumber,
      title: cleanText(albumTitle) || `Tome ${volumeNumber}`,
      isbn: isbn,
      upc: null,
      authors: null,
      publisher: publisher,
      published_year: publishedYear,
      cover_image_url: null
    });
    series.total_volumes = series.albums.length;
  }

  return Array.from(seriesMap.values());
}

/**
 * Parse un export JSON BDovore ou structure de secours
 */
export function parseBdovoreJson(filePath: string): ScrapedSeries[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err: any) {
    console.error(`[BDovore] Erreur parsing JSON: ${err.message}`);
    return [];
  }
}

/**
 * Catalogue de référence de complément BDovore (Franco-belge et Mangas populaires)
 */
export function getBdovoreReferenceSeed(): ScrapedSeries[] {
  return [
    {
      id: "series_bdv_black_et_mortimer",
      title: "Blake et Mortimer",
      type: "Franco-belge",
      status: "En cours",
      total_volumes: 30,
      publisher_default: "Éditions Blake et Mortimer",
      albums: [
        {
          id: "alb_bdv_bm_01",
          volume_number: 1,
          title: "Le Secret de l'Espadon, Tome 1",
          isbn: "9782870970089",
          upc: null,
          authors: "Edgar P. Jacobs",
          publisher: "Éditions Blake et Mortimer",
          published_year: 1950,
          cover_image_url: "https://covers.openlibrary.org/b/isbn/9782870970089-L.jpg"
        },
        {
          id: "alb_bdv_bm_02",
          volume_number: 2,
          title: "Le Secret de l'Espadon, Tome 2",
          isbn: "9782870970096",
          upc: null,
          authors: "Edgar P. Jacobs",
          publisher: "Éditions Blake et Mortimer",
          published_year: 1953,
          cover_image_url: "https://covers.openlibrary.org/b/isbn/9782870970096-L.jpg"
        },
        {
          id: "alb_bdv_bm_03",
          volume_number: 3,
          title: "Le Mystère de la Grande Pyramide, Tome 1",
          isbn: "9782870970119",
          upc: null,
          authors: "Edgar P. Jacobs",
          publisher: "Éditions Blake et Mortimer",
          published_year: 1954,
          cover_image_url: "https://covers.openlibrary.org/b/isbn/9782870970119-L.jpg"
        }
      ]
    },
    {
      id: "series_bdv_largo_winch",
      title: "Largo Winch",
      type: "Franco-belge",
      status: "En cours",
      total_volumes: 24,
      publisher_default: "Dupuis",
      albums: [
        {
          id: "alb_bdv_lw_01",
          volume_number: 1,
          title: "L'Héritier",
          isbn: "9782800117911",
          upc: null,
          authors: "Jean Van Hamme, Philippe Francq",
          publisher: "Dupuis",
          published_year: 1990,
          cover_image_url: "https://covers.openlibrary.org/b/isbn/9782800117911-L.jpg"
        },
        {
          id: "alb_bdv_lw_02",
          volume_number: 2,
          title: "Le Groupe W",
          isbn: "9782800118321",
          upc: null,
          authors: "Jean Van Hamme, Philippe Francq",
          publisher: "Dupuis",
          published_year: 1991,
          cover_image_url: "https://covers.openlibrary.org/b/isbn/9782800118321-L.jpg"
        }
      ]
    }
  ];
}

/**
 * Exécute l'extraction BDovore (export de fichier ou référence)
 */
export async function scrapeBdovore(customFilePath?: string): Promise<ScrapedSeries[]> {
  console.log(`\n📦 [BDovore] Amorçage des données BDovore...`);
  
  if (customFilePath && fs.existsSync(customFilePath)) {
    if (customFilePath.endsWith('.csv')) {
      console.log(`  -> Lecture de l'export CSV : ${customFilePath}`);
      return parseBdovoreCsv(customFilePath);
    }
    if (customFilePath.endsWith('.json')) {
      console.log(`  -> Lecture de l'export JSON : ${customFilePath}`);
      return parseBdovoreJson(customFilePath);
    }
  }

  // Vérifier si un export existe dans scripts/seeding/bdovore_export.json ou .csv
  const defaultCsv = path.resolve(process.cwd(), 'scripts/seeding/bdovore_export.csv');
  if (fs.existsSync(defaultCsv)) {
    console.log(`  -> Trouvé export CSV local : ${defaultCsv}`);
    return parseBdovoreCsv(defaultCsv);
  }

  console.log(`  -> Intégration du catalogue de référence étendu BDovore`);
  return getBdovoreReferenceSeed();
}
