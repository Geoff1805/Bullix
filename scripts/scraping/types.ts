/**
 * Définition des types pour le scraping et l'ingestion Bullix
 */

export type SeriesType = 'Franco-belge' | 'Manga' | 'Comics' | 'Autre';
export type SeriesStatus = 'En cours' | 'Terminée' | 'Abandonnée' | 'Inconnue';

export interface ScrapedAlbum {
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

export interface ScrapedSeries {
  id: string;
  title: string;
  type: SeriesType;
  status: SeriesStatus;
  total_volumes: number | null;
  publisher_default: string | null;
  albums: ScrapedAlbum[];
}

export interface ScrapingOptions {
  source?: 'all' | 'bdtheque' | 'bdovore';
  maxPerCategory?: number;
  categories?: Array<'BD' | 'Manga' | 'Comics'>;
  startPage?: number;
  autoAdvance?: boolean;
  resetState?: boolean;
  letter?: string;
  bdovoreFile?: string;
  outputJson?: string;
  outputSql?: string;
  delayMs?: number;
  verbose?: boolean;
}
