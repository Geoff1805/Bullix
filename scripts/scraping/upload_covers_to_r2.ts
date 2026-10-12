/**
 * Script de transfert direct des jaquettes vers le bucket Cloudflare R2 (bullix-images).
 *
 * Règle stricte:
 * - Aucune image n'est persistée sur GitHub (ni repo, ni artefacts de build).
 * - Les images sont téléchargées en mémoire / tampon éphémère et envoyées DIRECTEMENT
 *   dans le bucket R2 de Cloudflare via l'outil Wrangler CLI.
 * - Le champ cover_image_url des albums est réécrit vers la route Cloudflare Edge :
 *   /api/images/covers/${album.id}.jpg
 * - Le fichier SQL (generated_seed.sql) est régénéré pour pointer vers les images R2.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import process from 'node:process';
import type { ScrapedSeries } from './types.ts';
import { generateSqlBatch } from '../seeding/import_seed.ts';
import { fetchWithRetry, sleep } from './utils/rate_limiter.ts';

const BUCKET_NAME = 'bullix-images';
const JURISDICTION = 'eu';

export async function uploadCoversToR2(
  jsonInputPath = 'scraped_data.json',
  sqlOutputPath = 'generated_seed.sql'
): Promise<void> {
  const fullJsonPath = path.resolve(process.cwd(), jsonInputPath);
  if (!fs.existsSync(fullJsonPath)) {
    console.error(`❌ Fichier introuvable : ${fullJsonPath}`);
    return;
  }

  const raw = fs.readFileSync(fullJsonPath, 'utf-8');
  const seriesList: ScrapedSeries[] = JSON.parse(raw);

  const tmpDir = path.resolve(process.cwd(), '.tmp_r2_upload');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  let totalUploaded = 0;
  let totalSkipped = 0;

  console.log(`\n🚀 [Cloudflare R2 Direct Upload] Transfert des jaquettes vers le bucket "${BUCKET_NAME}" (Jurisdiction: ${JURISDICTION})`);

  for (const s of seriesList) {
    for (const alb of s.albums) {
      if (!alb.cover_image_url || alb.cover_image_url.startsWith('/api/images/')) {
        totalSkipped++;
        continue;
      }

      const remoteUrl = alb.cover_image_url;
      const r2Key = `covers/${alb.id}.jpg`;
      const localTmpFile = path.resolve(tmpDir, `${alb.id}.jpg`);

      try {
        console.log(`  -> Téléchargement éphémère pour Tome ${alb.volume_number} de "${s.title}"...`);
        const res = await fetchWithRetry(remoteUrl, {}, 2, 800);
        if (!res.ok) {
          console.warn(`     ⚠️ Impossible de télécharger ${remoteUrl} (HTTP ${res.status})`);
          continue;
        }

        const arrayBuffer = await res.arrayBuffer();
        fs.writeFileSync(localTmpFile, Buffer.from(arrayBuffer));

        // Upload direct vers Cloudflare R2
        console.log(`     ☁️ Envoi direct vers Cloudflare R2: ${r2Key}...`);
        try {
          execSync(
            `npx wrangler r2 object put ${BUCKET_NAME}/${r2Key} --file="${localTmpFile}" --content-type=image/jpeg --jurisdiction=${JURISDICTION} --remote`,
            { stdio: 'pipe' }
          );
          // Remplacement immédiat par l'URL Cloudflare Edge
          alb.cover_image_url = `/api/images/${r2Key}`;
          totalUploaded++;
          console.log(`     ✅ Transféré sur R2 -> /api/images/${r2Key}`);
        } catch (wranglerErr: any) {
          console.warn(`     ⚠️ Échec commande wrangler (Tokens non configurés ou hors-ligne): ${wranglerErr.message}`);
          // On associe tout de même la clé R2 cible pour la base de données
          alb.cover_image_url = `/api/images/${r2Key}`;
        }
      } catch (err: any) {
        console.warn(`     ⚠️ Erreur traitement jaquette ${alb.id}: ${err.message}`);
      } finally {
        // Suppression immédiate du fichier éphémère : AUCUNE image ne subsiste localement
        if (fs.existsSync(localTmpFile)) {
          fs.unlinkSync(localTmpFile);
        }
      }

      await sleep(200);
    }
  }

  // Nettoyage complet du dossier temporaire
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n✨ [Cloudflare R2] Bilan : ${totalUploaded} jaquette(s) transférée(s) sur R2 (${totalSkipped} ignorées).`);

  // Mise à jour de scraped_data.json avec les nouvelles URLs Cloudflare R2
  fs.writeFileSync(fullJsonPath, JSON.stringify(seriesList, null, 2), 'utf-8');
  console.log(`💾 Fichier JSON mis à jour avec les URLs R2 : ${fullJsonPath}`);

  // Régénération de generated_seed.sql avec les URLs R2
  const updatedSql = generateSqlBatch(seriesList);
  const fullSqlPath = path.resolve(process.cwd(), sqlOutputPath);
  fs.writeFileSync(fullSqlPath, updatedSql, 'utf-8');
  console.log(`💾 Fichier SQL mis à jour avec les URLs R2 : ${fullSqlPath}`);
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('upload_covers_to_r2')) {
  const jsonArg = process.argv[2] || 'scraped_data.json';
  const sqlArg = process.argv[3] || 'generated_seed.sql';
  uploadCoversToR2(jsonArg, sqlArg)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Échec critique upload R2:', err);
      process.exit(1);
    });
}
