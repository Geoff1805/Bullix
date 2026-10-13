interface Env {
  DB: D1Database;
  IMAGES_BUCKET: R2Bucket;
}

/**
 * Endpoint de synchronisation autonome des images dans Cloudflare
 * Parcourt les albums dans D1 qui possèdent une URL externe (http...) ou non encore dans R2,
 * les télécharge via Cloudflare Workers et les enregistre dans R2.
 * 
 * Usage: GET /api/images/sync?limit=25
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));

    if (!env.DB || !env.IMAGES_BUCKET) {
      return new Response(JSON.stringify({ error: 'Bindings D1 ou R2 manquants' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Récupérer les albums avec URL externe
    const { results } = await env.DB.prepare(`
      SELECT id, title, cover_image_url
      FROM albums
      WHERE deleted_at IS NULL
        AND cover_image_url LIKE 'http%'
      LIMIT ?
    `)
      .bind(limit)
      .all<{ id: string; title: string; cover_image_url: string }>();

    const albums = results || [];
    let syncedCount = 0;
    const details: any[] = [];

    for (const alb of albums) {
      const r2Key = `covers/${alb.id}.jpg`;
      const existing = await env.IMAGES_BUCKET.get(r2Key);
      if (existing) {
        // Déjà dans R2 : on met à jour D1 pour pointer vers la route Cloudflare Edge
        await env.DB.prepare(`UPDATE albums SET cover_image_url = ? WHERE id = ?`)
          .bind(`/api/images/${r2Key}`, alb.id)
          .run();
        details.push({ id: alb.id, status: 'already_in_r2' });
        continue;
      }

      try {
        const res = await fetch(alb.cover_image_url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 Bullix-Cloudflare-Worker/1.0',
            'Accept': 'image/*,*/*;q=0.8',
          },
        });

        if (res.ok) {
          const contentType = res.headers.get('Content-Type') || 'image/jpeg';
          const buffer = await res.arrayBuffer();

          await env.IMAGES_BUCKET.put(r2Key, buffer, {
            httpMetadata: { contentType },
          });

          // Mettre à jour l'URL dans D1
          await env.DB.prepare(`UPDATE albums SET cover_image_url = ? WHERE id = ?`)
            .bind(`/api/images/${r2Key}`, alb.id)
            .run();

          syncedCount++;
          details.push({ id: alb.id, status: 'synced_to_r2' });
        } else {
          details.push({ id: alb.id, status: `http_${res.status}` });
        }
      } catch (err: any) {
        details.push({ id: alb.id, status: 'error', message: err?.message });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: albums.length,
        synced: syncedCount,
        details,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Erreur interne' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
