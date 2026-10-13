interface Env {
  DB: D1Database;
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

    // Traitement par batch avec résolution de conflits "Last-Write-Wins" (LWW)
    for (const record of body.records) {
      const existing = await env.DB.prepare(
        'SELECT updated_at FROM records WHERE id = ?'
      )
        .bind(record.id)
        .first<{ updated_at: number }>();

      if (!existing || record.updated_at >= existing.updated_at) {
        // 1. Sauvegarde dans le journal records
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
            Date.now(),
            record.updated_at,
            record.deleted_at
          )
          .run();

        // 2. Application directe dans la table relationnelle correspondante
        try {
          const parsed = JSON.parse(record.payload);
          if (record.entity_type === 'user_collection') {
            if (record.deleted_at) {
              await env.DB.prepare(`UPDATE user_collection SET deleted_at = ?, updated_at = ? WHERE id = ?`)
                .bind(record.deleted_at, record.updated_at, record.id)
                .run();
            } else {
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
        } catch (parseErr) {
          console.warn('[Sync Push] Impossible de décoder le payload relationnel:', parseErr);
        }

        acknowledgedIds.push(record.id);
      } else {
        // Enregistrement serveur plus récent : rejet du push local, sera résolu au prochain pull
        acknowledgedIds.push(record.id);
      }
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
