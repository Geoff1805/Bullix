/**
 * Script de transfert direct des jaquettes vers le bucket Cloudflare R2 (bullix-images).
 *
 * Règle stricte:
 * - Aucune image n'est persistée sur GitHub (ni repo, ni artefacts de build).
 * - Les images sont téléchargées en mémoire / tampon éphémère et envoyées DIRECTEMENT
 *   dans le bucket R2 de Cloudflare via l'API REST Cloudflare ou l'outil Wrangler CLI.
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

function loadEnvIfPresent(): { apiToken?: string; accountId?: string } {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) {
        const key = m[1];
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }

  const manualInfoPath = path.resolve(process.cwd(), 'infos manuelles.txt');
  if (fs.existsSync(manualInfoPath) && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    const content = fs.readFileSync(manualInfoPath, 'utf-8');
    const m = content.match(/Account ID\s*:\s*([a-f0-9]+)/i);
    if (m) {
      process.env.CLOUDFLARE_ACCOUNT_ID = m[1];
    }
  }

  return {
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  };
}

export async function uploadCoversToR2(
  jsonInputPath = 'scraped_data.json',
  sqlOutputPath = 'generated_seed.sql'
): Promise<void> {
  const fullJsonPath = path.resolve(process.cwd(), jsonInputPath);
  if (!fs.existsSync(fullJsonPath)) {
    console.error(`❌ Fichier introuvable : ${fullJsonPath}`);
    return;
  }

  const { apiToken, accountId } = loadEnvIfPresent();

  const raw = fs.readFileSync(fullJsonPath, 'utf-8');
  const seriesList: ScrapedSeries[] = JSON.parse(raw);

  const tmpDir = path.resolve(process.cwd(), '.tmp_r2_upload');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  let totalUploaded = 0;
  let totalSkipped = 0;

  console.log(`\n🚀 [Cloudflare R2 Direct Upload] Transfert des jaquettes vers le bucket "${BUCKET_NAME}"`);

  // Assurer l'existence du bucket sur Cloudflare R2
  if (apiToken && accountId) {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET_NAME}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiToken}` },
        }
      );
      if (res.ok) {
        console.log(`  📦 Bucket R2 "${BUCKET_NAME}" vérifié et actif sur votre compte.`);
      } else {
        await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: BUCKET_NAME }),
          }
        );
        console.log(`  📦 Bucket R2 "${BUCKET_NAME}" créé.`);
      }
    } catch {
      // Ignoré, continuation
    }
  }

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
        const buffer = Buffer.from(arrayBuffer);
        let uploadOk = false;

        // 1. Upload direct ultra-rapide via API REST Cloudflare R2 (streaming sans sous-processus)
        if (apiToken && accountId) {
          try {
            const putRes = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET_NAME}/objects/${r2Key}`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${apiToken}`,
                  'Content-Type': 'image/jpeg',
                },
                body: buffer,
              }
            );
            if (putRes.ok) {
              uploadOk = true;
            } else {
              const errJson: any = await putRes.json().catch(() => null);
              console.warn(`     ⚠️ Échec API R2 HTTP ${putRes.status}: ${JSON.stringify(errJson?.errors || errJson)}`);
            }
          } catch (apiErr: any) {
            console.warn(`     ⚠️ Erreur réseau API R2: ${apiErr.message}`);
          }
        }

        // 2. Repli secondaire via Wrangler CLI si l'appel direct n'a pas réussi
        if (!uploadOk) {
          fs.writeFileSync(localTmpFile, buffer);
          try {
            execSync(
              `npx wrangler r2 object put ${BUCKET_NAME}/${r2Key} --file="${localTmpFile}" --content-type=image/jpeg --remote`,
              { stdio: 'pipe' }
            );
            uploadOk = true;
          } catch {
            try {
              execSync(
                `npx wrangler r2 object put ${BUCKET_NAME}/${r2Key} --file="${localTmpFile}" --content-type=image/jpeg --jurisdiction=eu --remote`,
                { stdio: 'pipe' }
              );
              uploadOk = true;
            } catch (wranglerErr: any) {
              console.warn(`     ⚠️ Échec commande wrangler: ${wranglerErr.message}`);
            }
          }
        }

        alb.cover_image_url = `/api/images/${r2Key}`;
        if (uploadOk) {
          totalUploaded++;
          console.log(`     ✅ Transféré sur R2 -> /api/images/${r2Key}`);
        }
      } catch (err: any) {
        console.warn(`     ⚠️ Erreur traitement jaquette ${alb.id}: ${err.message}`);
      } finally {
        // Suppression immédiate du fichier éphémère si créé localement
        if (fs.existsSync(localTmpFile)) {
          fs.unlinkSync(localTmpFile);
        }
      }

      await sleep(150);
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
