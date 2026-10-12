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
