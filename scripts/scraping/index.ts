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

  console.log(`\n🚀 [Bullix Scraping Engine] Démarrage de l'extraction`);
  console.log(`   Source : ${source}`);
  console.log(`   Max par catégorie : ${maxPerCategory}`);
  console.log(`   Catégories : ${categories.join(', ')}`);

  const collected: ScrapedSeries[] = [];

  // 1. Scraping BDThèque
  if (source === 'all' || source === 'bdtheque') {
    try {
      const bdtResults = await scrapeBdtheque(maxPerCategory, categories, options.delayMs || 600);
      collected.push(...bdtResults);
      console.log(`✅ [BDThèque] ${bdtResults.length} série(s) extraite(s) avec succès.`);
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

  // 3. Normalisation & Dédoublonnage
  console.log(`\n🔄 [Normalisation] Fusion et dédoublonnage de ${collected.length} série(s) brutes...`);
  const mergedSeries = deduplicateAndMergeSeries(collected);
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

  // 4. Écriture du JSON
  const fullJsonPath = path.resolve(process.cwd(), outputJson);
  fs.writeFileSync(fullJsonPath, JSON.stringify(mergedSeries, null, 2), 'utf-8');
  console.log(`💾 Fichier JSON sauvegardé : ${fullJsonPath}`);

  // 5. Génération du batch SQL pour Cloudflare D1
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
