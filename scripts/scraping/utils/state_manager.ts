/**
 * Gestionnaire d'état persistant pour le scraping Bullix.
 * Permet d'avancer de page en page, d'éviter de rescraper les mêmes séries,
 * et d'assurer une découverte incrémentale d'albums différents à chaque exécution.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import type { ScrapedSeries } from '../types.ts';

const STATE_FILE = '.scraping_state.json';

export interface ScrapingState {
  pages: Record<string, number>;
  scraped_series_ids: string[];
  total_runs: number;
  last_run_at: string;
}

export class ScrapingStateManager {
  private filePath: string;
  private state: ScrapingState;

  constructor(baseDir: string = process.cwd()) {
    this.filePath = path.resolve(baseDir, STATE_FILE);
    this.state = this.loadState();
    this.seedFromExistingData(baseDir);
  }

  private loadState(): ScrapingState {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw);
      } catch {
        // En cas d'erreur de lecture, réinitialiser proprement
      }
    }
    return {
      pages: {
        BD: 1,
        Manga: 1,
        Comics: 1,
      },
      scraped_series_ids: [],
      total_runs: 0,
      last_run_at: new Date().toISOString(),
    };
  }

  /**
   * Initialise les IDs déjà connus depuis scraped_data.json si présent
   */
  private seedFromExistingData(baseDir: string): void {
    const jsonPath = path.resolve(baseDir, 'scraped_data.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const series: ScrapedSeries[] = JSON.parse(raw);
        const set = new Set(this.state.scraped_series_ids);
        for (const s of series) {
          if (s.id) set.add(s.id);
        }
        this.state.scraped_series_ids = Array.from(set);
      } catch {
        // Ignorer si parsing impossible
      }
    }
  }

  /**
   * Détermine la page de départ pour une catégorie
   */
  public getStartPage(category: string, requestedPage?: number, autoAdvance = true): number {
    if (requestedPage !== undefined && requestedPage > 0) {
      return requestedPage;
    }
    const current = this.state.pages[category] || 1;
    return autoAdvance && this.state.total_runs > 0 ? current + 1 : current;
  }

  /**
   * Vérifie si une série a déjà été extraite
   */
  public isAlreadyScraped(seriesId: string): boolean {
    return this.state.scraped_series_ids.includes(seriesId);
  }

  /**
   * Enregistre la progression d'un run
   */
  public updateProgress(category: string, pageReached: number, newSeriesIds: string[]): void {
    this.state.pages[category] = pageReached;
    const set = new Set(this.state.scraped_series_ids);
    for (const id of newSeriesIds) {
      set.add(id);
    }
    this.state.scraped_series_ids = Array.from(set);
  }

  /**
   * Sauvegarde l'état sur disque
   */
  public save(): void {
    this.state.total_runs += 1;
    this.state.last_run_at = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  /**
   * Réinitialise les curseurs de pages à 1
   */
  public reset(): void {
    this.state.pages = { BD: 1, Manga: 1, Comics: 1 };
    this.save();
    console.log('🔄 Curseur de scraping réinitialisé à la page 1 pour toutes les catégories.');
  }

  public getState(): ScrapingState {
    return this.state;
  }
}
