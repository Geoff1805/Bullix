/**
 * Utilitaires de normalisation, nettoyage et dédoublonnage de données
 */

import type { ScrapedSeries, ScrapedAlbum, SeriesType } from '../types.ts';

/**
 * Nettoie un ISBN (retire les tirets, espaces et valide la longueur 10 ou 13 caractères)
 */
export function cleanIsbn(isbn: string | null | undefined): string | null {
  if (!isbn) return null;
  const cleaned = isbn.replace(/[-\s]/g, '').trim().toUpperCase();
  if (/^[0-9]{9}[0-9X]$/.test(cleaned) || /^[0-9]{13}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

/**
 * Nettoie un titre de chaîne (supprime les espaces superflus)
 */
export function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Génère une clé canonique de titre pour le dédoublonnage
 */
export function canonicalTitleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(le|la|les|l'|un|une|des)\s+/i, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Détecte le type de série selon les mots-clés
 */
export function inferSeriesType(genreOrText: string): SeriesType {
  const lower = genreOrText.toLowerCase();
  if (lower.includes('manga') || lower.includes('shonen') || lower.includes('seinen') || lower.includes('shojo')) {
    return 'Manga';
  }
  if (lower.includes('comic') || lower.includes('super-héros') || lower.includes('marvel') || lower.includes('dc')) {
    return 'Comics';
  }
  return 'Franco-belge';
}

/**
 * Dédoublonne et fusionne des séries provenant de multiples sources (ex: BDthèque + BDvore)
 */
export function deduplicateAndMergeSeries(seriesList: ScrapedSeries[]): ScrapedSeries[] {
  const map = new Map<string, ScrapedSeries>();

  for (const item of seriesList) {
    const key = canonicalTitleKey(item.title);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, { ...item });
      continue;
    }

    // Fusion de la série existante avec les nouvelles informations
    if (existing.status === 'Inconnue' && item.status !== 'Inconnue') {
      existing.status = item.status;
    }
    if (!existing.publisher_default && item.publisher_default) {
      existing.publisher_default = item.publisher_default;
    }
    if ((existing.total_volumes === null || existing.total_volumes === 0) && item.total_volumes) {
      existing.total_volumes = item.total_volumes;
    }

    // Fusion des albums par numéro de volume
    const albumsMap = new Map<number, ScrapedAlbum>();
    for (const alb of existing.albums) {
      albumsMap.set(alb.volume_number, alb);
    }

    for (const alb of item.albums) {
      const existingAlb = albumsMap.get(alb.volume_number);
      if (!existingAlb) {
        albumsMap.set(alb.volume_number, alb);
      } else {
        // Enrichissement des champs manquants
        if (!existingAlb.isbn && alb.isbn) existingAlb.isbn = alb.isbn;
        if (!existingAlb.cover_image_url && alb.cover_image_url) existingAlb.cover_image_url = alb.cover_image_url;
        if (!existingAlb.authors && alb.authors) existingAlb.authors = alb.authors;
        if (!existingAlb.publisher && alb.publisher) existingAlb.publisher = alb.publisher;
        if (!existingAlb.published_year && alb.published_year) existingAlb.published_year = alb.published_year;
      }
    }

    existing.albums = Array.from(albumsMap.values()).sort((a, b) => a.volume_number - b.volume_number);
    if (!existing.total_volumes || existing.total_volumes < existing.albums.length) {
      existing.total_volumes = existing.albums.length;
    }
  }

  return Array.from(map.values());
}
