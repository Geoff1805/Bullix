/**
 * Orchestrateur principal de Scraping et d'Importation pour Bullix
 * Combine les sources BDthèque et BDvore, dédoublonne, génère le JSON et le SQL batch pour D1.
 *
 * Usage:
 *   npx tsx scripts/scraping/index.ts [options]
 *
 * Options:
 *   --source=all|bdtheque|bdovore   Source à scraper (défaut: all)
 *   --max=10                        Nombre max de séries par catégorie (défaut: 5)
 *   --categories=BD,Manga,Comics    Catégories ciblées (défaut: BD,Manga,Comics)
 *   --bdovore-file=path.csv         Fichier d'export optionnel BDovore
 *   --output=scraped_data.json      Fichier JSON de sortie (défaut: scraped_data.json)
 *   --sql=generated_seed.sql        Fichier SQL de sortie (défaut: generated_seed.sql)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import type { ScrapedSeries, ScrapingOptions } from './types.ts';
import { scrapeBdtheque } from './sources/bdtheque.ts';
import { scrapeBdovore } from './sources/bdovore.ts';
import { deduplicateAndMergeSeries } from './utils/normalizer.ts';
import { generateSqlBatch } from '../seeding/import_seed.ts';

import { ScrapingStateManager } from './utils/state_manager.ts';

// Désactive la vérification TLS stricte pour les environnements avec proxies / CAs personnalisées
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export async function runScraping(options: ScrapingOptions = {}): Promise<{
  series: ScrapedSeries[];
  jsonPath: string;
  sqlPath: string;
}> {
  const source = options.source || 'all';
  const maxPerCategory = options.maxPerCategory || 5;
  const categories = options.categories || ['BD', 'Manga', 'Comics'];
  const outputJson = options.outputJson || 'scraped_data.json';
  const outputSql = options.outputSql || 'generated_seed.sql';

  const stateManager = new ScrapingStateManager();
  if (options.resetState) {
    stateManager.reset();
  }

  const startPages: Record<string, number> = {};
  for (const cat of categories) {
    startPages[cat] = stateManager.getStartPage(cat, options.startPage, options.autoAdvance !== false);
  }

  console.log(`\n🚀 [Bullix Scraping Engine] Démarrage de l'extraction incrémentale`);
  console.log(`   Source : ${source}`);
  console.log(`   Max par catégorie : ${maxPerCategory}`);
  console.log(`   Catégories & pages de départ : ${categories.map(c => `${c} (p.${startPages[c]})`).join(', ')}`);
  console.log(`   Séries déjà en historique : ${stateManager.getState().scraped_series_ids.length}`);

  const collected: ScrapedSeries[] = [];
  const knownIds = new Set(stateManager.getState().scraped_series_ids);

  // 1. Scraping BDThèque
  if (source === 'all' || source === 'bdtheque') {
    try {
      const bdtResults = await scrapeBdtheque(
        maxPerCategory,
        categories,
        options.delayMs || 600,
        startPages,
        knownIds,
        (cat, page, newIds) => {
          stateManager.updateProgress(cat, page, newIds);
        }
      );
      collected.push(...bdtResults);
      console.log(`✅ [BDThèque] ${bdtResults.length} nouvelle(s) série(s) extraite(s) avec succès.`);
    } catch (err: any) {
      console.error(`❌ [BDThèque] Erreur lors de l'extraction: ${err.message}`);
    }
  }

  // 2. Scraping / Import BDovore
  if (source === 'all' || source === 'bdovore') {
    try {
      const bdvResults = await scrapeBdovore(options.bdovoreFile);
      collected.push(...bdvResults);
      console.log(`✅ [BDovore] ${bdvResults.length} série(s) importée(s) avec succès.`);
    } catch (err: any) {
      console.error(`❌ [BDovore] Erreur lors de l'import BDovore: ${err.message}`);
    }
  }

  // 3. Récupération des données existantes pour fusion incrémentale
  const fullJsonPath = path.resolve(process.cwd(), outputJson);
  const existingSeries: ScrapedSeries[] = [];
  if (fs.existsSync(fullJsonPath)) {
    try {
      const rawExisting = fs.readFileSync(fullJsonPath, 'utf-8');
      existingSeries.push(...JSON.parse(rawExisting));
    } catch {
      // Ignorer si corrompu
    }
  }

  // 4. Normalisation & Fusion (Données existantes + Nouvelles collectées)
  console.log(`\n🔄 [Normalisation] Fusion incrémentale de ${existingSeries.length} série(s) existante(s) et ${collected.length} nouvelle(s)...`);
  const mergedSeries = deduplicateAndMergeSeries([...existingSeries, ...collected]);
  console.log(`✨ [Normalisation] Résultat unifié : ${mergedSeries.length} série(s) uniques.`);

  // Statistiques
  let totalAlbums = 0;
  let totalWithIsbn = 0;
  for (const s of mergedSeries) {
    totalAlbums += s.albums.length;
    for (const a of s.albums) {
      if (a.isbn) totalWithIsbn++;
    }
  }
  console.log(`📊 Statistiques globales : ${totalAlbums} albums répertoriés (${totalWithIsbn} avec ISBN/EAN valides).`);

  // Sauvegarde de l'état d'avancement
  stateManager.save();

  // 5. Écriture du JSON
  fs.writeFileSync(fullJsonPath, JSON.stringify(mergedSeries, null, 2), 'utf-8');
  console.log(`💾 Fichier JSON sauvegardé : ${fullJsonPath}`);

  // 6. Génération du batch SQL pour Cloudflare D1
  const sqlBatch = generateSqlBatch(mergedSeries);
  const fullSqlPath = path.resolve(process.cwd(), outputSql);
  fs.writeFileSync(fullSqlPath, sqlBatch, 'utf-8');
  console.log(`💾 Fichier SQL sauvegardé : ${fullSqlPath} (${(Buffer.byteLength(sqlBatch) / 1024).toFixed(1)} Ko)`);

  return {
    series: mergedSeries,
    jsonPath: fullJsonPath,
    sqlPath: fullSqlPath
  };
}

// Exécution directe via CLI
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('scraping')) {
  const args = process.argv.slice(2);
  const options: ScrapingOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--source=')) {
      options.source = arg.split('=')[1] as any;
    } else if (arg.startsWith('--max=')) {
      options.maxPerCategory = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--categories=')) {
      options.categories = arg.split('=')[1].split(',') as any;
    } else if (arg.startsWith('--output=')) {
      options.outputJson = arg.split('=')[1];
    } else if (arg.startsWith('--sql=')) {
      options.outputSql = arg.split('=')[1];
    } else if (arg.startsWith('--bdovore-file=')) {
      options.bdovoreFile = arg.split('=')[1];
    } else if (arg.startsWith('--page=')) {
      options.startPage = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--reset') {
      options.resetState = true;
    } else if (arg === '--no-advance') {
      options.autoAdvance = false;
    }
  }

  runScraping(options)
    .then(() => {
      console.log(`\n🎉 Scraping et génération du seed terminés avec succès !`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\n❌ Échec critique du scraping :`, err);
      process.exit(1);
    });
}
