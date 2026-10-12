/**
 * Scraper pour BDThèque (bdtheque.com)
 * Récupère les métadonnées de séries et l'ensemble de leurs tomes via l'endpoint AJAX optimisé.
 */

import type { ScrapedSeries, ScrapedAlbum, SeriesType, SeriesStatus } from '../types.ts';
import { fetchWithRetry, sleep } from '../utils/rate_limiter.ts';
import { cleanIsbn, cleanText } from '../utils/normalizer.ts';

const BASE_URL = 'https://www.bdtheque.com';

interface SeriesListingItem {
  id: number;
  slug: string;
}

/**
 * Récupère la liste des séries d'une catégorie (BD, Manga, Comics)
 */
export async function fetchSeriesList(
  category: 'BD' | 'Manga' | 'Comics',
  limit = 10
): Promise<SeriesListingItem[]> {
  const url = `${BASE_URL}/recherche/series/type=${category}`;
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) {
      console.warn(`[BDThèque] Impossible de récupérer la liste pour ${category} (HTTP ${res.status})`);
      return [];
    }
    const html = await res.text();
    const matches = html.match(/\/series\/([0-9]+)\/([a-z0-9-]+)/gi) || [];
    
    const uniqueMap = new Map<number, SeriesListingItem>();
    for (const m of matches) {
      const parts = m.split('/');
      const id = parseInt(parts[2], 10);
      const slug = parts[3];
      if (!isNaN(id) && slug && !uniqueMap.has(id)) {
        uniqueMap.set(id, { id, slug });
      }
      if (uniqueMap.size >= limit) break;
    }

    return Array.from(uniqueMap.values());
  } catch (err: any) {
    console.error(`[BDThèque] Erreur lors de la récupération de la liste ${category}:`, err.message);
    return [];
  }
}

/**
 * Récupère les détails d'une série et tous ses tomes
 */
export async function fetchSeriesDetails(
  seriesId: number,
  slug: string
): Promise<ScrapedSeries | null> {
  const seriesUrl = `${BASE_URL}/series/${seriesId}/${slug}`;
  try {
    const res = await fetchWithRetry(seriesUrl);
    if (!res.ok) {
      console.warn(`[BDThèque] Série introuvable: ${seriesUrl} (HTTP ${res.status})`);
      return null;
    }
    const html = await res.text();

    // 1. Titre
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)-/i);
    const title = titleMatch ? cleanText(titleMatch[1]) : cleanText(slug.replace(/-/g, ' '));

    // 2. Éditeur
    const pubMatch = html.match(/recherche\/series\/editeur=([^"'>]+)/i);
    const publisherDefault = pubMatch ? decodeURIComponent(pubMatch[1]).replace(/\+/g, ' ').trim() : null;

    // 3. Type
    let type: SeriesType = 'Franco-belge';
    if (/recherche\/series\/type=Manga/i.test(html)) type = 'Manga';
    else if (/recherche\/series\/type=Comics/i.test(html)) type = 'Comics';

    // 4. Statut
    let status: SeriesStatus = 'Inconnue';
    if (/recherche\/series\/histoire=serie-terminee/i.test(html)) status = 'Terminée';
    else if (/recherche\/series\/histoire=serie-en-cours/i.test(html)) status = 'En cours';
    else if (/recherche\/series\/histoire=serie-abandonnee/i.test(html)) status = 'Abandonnée';

    // 5. Albums via AJAX endpoint de BDThèque (catégorie 0 = tomes standard)
    const albumsAjaxUrl = `${BASE_URL}/ajax/series/tomes/${seriesId}/0`;
    const albumsRes = await fetchWithRetry(albumsAjaxUrl, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': seriesUrl
      }
    });

    const albums: ScrapedAlbum[] = [];
    if (albumsRes.ok) {
      const albumsHtml = await albumsRes.text();
      const cards = albumsHtml.split(/<div class="card\s+/);

      for (let i = 1; i < cards.length; i++) {
        const card = cards[i];

        // Numéro de tome et titre
        const titleRegex = /<h5 class="card-title">([^<]+)<\/h5>/i;
        const tMatch = card.match(titleRegex);
        let volumeNumber = albums.length + 1;
        let albumTitle = `Tome ${volumeNumber}`;

        if (tMatch) {
          const fullT = tMatch[1].trim();
          const splitIdx = fullT.indexOf('-');
          if (splitIdx !== -1) {
            const numPart = fullT.substring(0, splitIdx).trim();
            const parsedNum = parseFloat(numPart.replace(',', '.'));
            if (!isNaN(parsedNum)) volumeNumber = parsedNum;
            const subTitle = fullT.substring(splitIdx + 1).trim();
            if (subTitle) albumTitle = subTitle;
          } else {
            albumTitle = fullT;
          }
        }

        // Jaquette
        const imgMatch = card.match(/<img[^>]+class="[^"]*cover[^"]*"[^>]+src="([^"]+)"/i);
        const coverUrl = imgMatch ? imgMatch[1] : null;

        // Année de parution
        const yearMatch = card.match(/annee=([0-9]{4})/i) || card.match(/parution\s*:\s*.*?([0-9]{4})/i);
        const publishedYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

        // ISBN
        const isbnMatch = card.match(/ISBN\s*:\s*([0-9Xx-]+)/i);
        const isbn = isbnMatch ? cleanIsbn(isbnMatch[1]) : null;

        // Auteurs (Scénariste + Dessinateur)
        const authorsList: string[] = [];
        const scenariste = card.match(/Scénariste\s*:\s*([^\n<]+)/i);
        const dessinateur = card.match(/(?:Illustrateur|Dessinateur)\s*:\s*([^\n<]+)/i);
        if (dessinateur) authorsList.push(dessinateur[1].trim());
        if (scenariste && !authorsList.includes(scenariste[1].trim())) {
          authorsList.push(scenariste[1].trim());
        }
        const authors = authorsList.length > 0 ? authorsList.join(', ') : null;

        albums.push({
          id: `alb_bdt_${seriesId}_${Math.round(volumeNumber * 10)}`,
          volume_number: volumeNumber,
          title: cleanText(albumTitle),
          isbn: isbn,
          upc: null,
          authors: authors,
          publisher: publisherDefault,
          published_year: publishedYear,
          cover_image_url: coverUrl
        });
      }
    }

    return {
      id: `series_bdt_${seriesId}`,
      title: title,
      type: type,
      status: status,
      total_volumes: albums.length > 0 ? albums.length : null,
      publisher_default: publisherDefault,
      albums: albums
    };
  } catch (err: any) {
    console.error(`[BDThèque] Erreur lors du scraping de la série ${seriesId} (${slug}):`, err.message);
    return null;
  }
}

/**
 * Scraping complet BDThèque sur les catégories spécifiées
 */
export async function scrapeBdtheque(
  limitPerCategory = 5,
  categories: Array<'BD' | 'Manga' | 'Comics'> = ['BD', 'Manga', 'Comics'],
  delayMs = 800
): Promise<ScrapedSeries[]> {
  const allSeries: ScrapedSeries[] = [];

  for (const cat of categories) {
    console.log(`\n📚 [BDThèque] Exploration de la catégorie : ${cat} (max ${limitPerCategory})...`);
    const list = await fetchSeriesList(cat, limitPerCategory);
    console.log(`🔍 [BDThèque] ${list.length} série(s) trouvée(s) pour ${cat}. Extraction des albums...`);

    for (const item of list) {
      console.log(`  -> Extraction : #${item.id} (${item.slug})`);
      const details = await fetchSeriesDetails(item.id, item.slug);
      if (details) {
        allSeries.push(details);
        console.log(`     ✅ ${details.title} (${details.albums.length} tomes répertoriés)`);
      }
      await sleep(delayMs);
    }
  }

  return allSeries;
}
