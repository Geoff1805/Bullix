interface Env {
  DB: D1Database;
  CACHE_KV?: KVNamespace;
}

interface SyncRecord {
  id: string;
  user_id: string;
  entity_type: 'series' | 'album' | 'location' | 'user_collection';
  payload: string;
  updated_at: number;
  deleted_at: number | null;
}

interface PushPayload {
  user_id: string;
  records: SyncRecord[];
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const body = (await request.json()) as PushPayload;

    if (!body || !body.records || !Array.isArray(body.records)) {
      return new Response(JSON.stringify({ error: 'Payload invalide' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const acknowledgedIds: string[] = [];
    const userId = body.user_id || 'default_user';

    // Traitement par batch avec résolution de conflits "Last-Write-Wins" (LWW)
    for (const record of body.records) {
      const now = Date.now();

      // 1. Sauvegarde dans D1 si disponible
      if (env.DB) {
        try {
          const existing = await env.DB.prepare(
            'SELECT updated_at FROM records WHERE id = ?'
          )
            .bind(record.id)
            .first<{ updated_at: number }>();

          if (!existing || record.updated_at >= existing.updated_at) {
            await env.DB.prepare(`
              INSERT INTO records (id, user_id, entity_type, payload, sync_status, created_at, updated_at, deleted_at)
              VALUES (?, ?, ?, ?, 'SYNCED', ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                payload = excluded.payload,
                sync_status = 'SYNCED',
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at
            `)
              .bind(
                record.id,
                record.user_id,
                record.entity_type,
                record.payload,
                now,
                record.updated_at,
                record.deleted_at
              )
              .run();

            // Application relationnelle résiliente
            try {
              const parsed = JSON.parse(record.payload);
              if (record.entity_type === 'user_collection') {
                if (record.deleted_at) {
                  await env.DB.prepare(`UPDATE user_collection SET deleted_at = ?, updated_at = ? WHERE id = ?`)
                    .bind(record.deleted_at, record.updated_at, record.id)
                    .run();
                } else {
                  // S'assurer que location existe si spécifiée
                  if (parsed.location_id) {
                    await env.DB.prepare(`
                      INSERT INTO locations (id, user_id, name, qr_code_ref, color_tag, created_at, updated_at)
                      VALUES (?, ?, 'Emplacement importé', NULL, '#4CAF50', ?, ?)
                      ON CONFLICT(id) DO NOTHING
                    `).bind(parsed.location_id, record.user_id, now, now).run().catch(() => {});
                  }

                  // S'assurer que series et album existent pour la clé étrangère
                  const albId = parsed.album_id;
                  const serId = parsed.series_id || `ser_${albId}`;
                  await env.DB.prepare(`
                    INSERT INTO series (id, title, type, status, created_at, updated_at)
                    VALUES (?, ?, ?, 'En cours', ?, ?)
                    ON CONFLICT(id) DO NOTHING
                  `).bind(serId, parsed.series_title || 'Sans série', parsed.series_type || 'Franco-belge', now, now).run().catch(() => {});

                  await env.DB.prepare(`
                    INSERT INTO albums (id, series_id, volume_number, title, isbn, authors, publisher, published_year, cover_image_url, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      title = COALESCE(excluded.title, albums.title),
                      cover_image_url = COALESCE(excluded.cover_image_url, albums.cover_image_url),
                      updated_at = excluded.updated_at
                  `).bind(
                    albId,
                    serId,
                    parsed.volume_number || 1,
                    parsed.album_title || 'Album',
                    parsed.isbn || null,
                    parsed.authors || null,
                    parsed.publisher || null,
                    parsed.published_year || null,
                    parsed.cover_image_url || null,
                    now,
                    now
                  ).run().catch(() => {});

                  await env.DB.prepare(`
                    INSERT INTO user_collection (
                      id, user_id, album_id, location_id, condition, edition_info,
                      purchase_price, notes, is_favorite, created_at, updated_at, deleted_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    ON CONFLICT(id) DO UPDATE SET
                      album_id = excluded.album_id,
                      location_id = excluded.location_id,
                      condition = excluded.condition,
                      edition_info = excluded.edition_info,
                      purchase_price = excluded.purchase_price,
                      notes = excluded.notes,
                      is_favorite = excluded.is_favorite,
                      updated_at = excluded.updated_at,
                      deleted_at = NULL
                  `)
                    .bind(
                      record.id,
                      record.user_id,
                      parsed.album_id,
                      parsed.location_id || null,
                      parsed.condition || 'Bon',
                      parsed.edition_info || 'Tirage standard',
                      parsed.purchase_price || null,
                      parsed.notes || null,
                      parsed.is_favorite ? 1 : 0,
                      record.updated_at,
                      record.updated_at
                    )
                    .run();
                }
              } else if (record.entity_type === 'location') {
                if (record.deleted_at) {
                  await env.DB.prepare(`UPDATE locations SET deleted_at = ?, updated_at = ? WHERE id = ?`)
                    .bind(record.deleted_at, record.updated_at, record.id)
                    .run();
                } else {
                  await env.DB.prepare(`
                    INSERT INTO locations (id, user_id, name, qr_code_ref, color_tag, created_at, updated_at, deleted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
                    ON CONFLICT(id) DO UPDATE SET
                      name = excluded.name,
                      qr_code_ref = excluded.qr_code_ref,
                      color_tag = excluded.color_tag,
                      updated_at = excluded.updated_at,
                      deleted_at = NULL
                  `)
                    .bind(
                      record.id,
                      record.user_id,
                      parsed.name,
                      parsed.qr_code_ref || null,
                      parsed.color_tag || null,
                      record.updated_at,
                      record.updated_at
                    )
                    .run();
                }
              }
            } catch (relationErr) {
              console.warn('[Sync Push] Avertissement relationnel D1:', relationErr);
            }
          }
        } catch (d1Err) {
          console.warn('[Sync Push] D1 non disponible, bascule KV:', d1Err);
        }
      }

      // 2. Sauvegarde miroir dans Cloudflare KV
      if (env.CACHE_KV) {
        try {
          const rawRecords = (await env.CACHE_KV.get(`bullix_sync_records_${userId}`, 'json') as any[]) || [];
          const updated = rawRecords.filter((r: any) => r.id !== record.id);
          updated.push(record);
          await env.CACHE_KV.put(`bullix_sync_records_${userId}`, JSON.stringify(updated));

          if (record.entity_type === 'user_collection') {
            const parsed = JSON.parse(record.payload);
            const rawCol = (await env.CACHE_KV.get(`bullix_collection_${userId}`, 'json') as any[]) || [];
            let updatedCol = rawCol.filter((c: any) => c.collection_id !== record.id && c.id !== record.id && c.album_id !== parsed.album_id);
            if (!record.deleted_at) {
              updatedCol.push({
                collection_id: record.id,
                user_id: record.user_id,
                album_id: parsed.album_id,
                location_id: parsed.location_id || null,
                condition: parsed.condition || 'Bon',
                edition_info: parsed.edition_info || 'Tirage standard',
                purchase_price: parsed.purchase_price || null,
                notes: parsed.notes || null,
                is_favorite: parsed.is_favorite ? 1 : 0,
                album_title: parsed.album_title || 'Album',
                series_title: parsed.series_title || 'Sans série',
                series_id: parsed.series_id || `ser_${parsed.album_id}`,
                series_type: parsed.series_type || 'Franco-belge',
                volume_number: parsed.volume_number || 1,
                authors: parsed.authors || null,
                publisher: parsed.publisher || null,
                published_year: parsed.published_year || null,
                cover_image_url: parsed.cover_image_url || null,
                isbn: parsed.isbn || null,
                created_at: record.updated_at,
                updated_at: record.updated_at,
              });
            }
            await env.CACHE_KV.put(`bullix_collection_${userId}`, JSON.stringify(updatedCol));
          }
        } catch (kvErr) {
          console.warn('[Sync Push] Erreur écriture KV:', kvErr);
        }
      }

      acknowledgedIds.push(record.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        acknowledged_ids: acknowledgedIds,
        server_timestamp: Date.now(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Erreur interne du serveur' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
