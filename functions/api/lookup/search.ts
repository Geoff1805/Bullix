interface Env {
  DB: D1Database;
  CACHE_KV: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim() || '';

    if (!query) {
      return new Response(JSON.stringify({ error: 'Paramètre q manquant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Base D1 non disponible', results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanQuery = query.replace(/[-\s]/g, '');
    const likePattern = `%${query}%`;
    const cleanLikePattern = `%${cleanQuery}%`;

    // Recherche multi-champs sur la base Cloudflare D1
    const { results } = await env.DB.prepare(`
      SELECT 
        a.id AS album_id,
        a.series_id,
        a.volume_number,
        a.title AS album_title,
        a.isbn,
        a.authors,
        a.publisher,
        a.published_year,
        a.cover_image_url,
        s.title AS series_title,
        s.type AS series_type,
        s.status AS series_status
      FROM albums a
      LEFT JOIN series s ON a.series_id = s.id
      WHERE a.deleted_at IS NULL AND (
        a.title LIKE ? OR
        a.isbn LIKE ? OR
        a.isbn LIKE ? OR
        a.authors LIKE ? OR
        a.publisher LIKE ? OR
        s.title LIKE ? OR
        s.type LIKE ? OR
        CAST(a.published_year AS TEXT) LIKE ? OR
        CAST(a.volume_number AS TEXT) LIKE ?
      )
      ORDER BY s.title ASC, a.volume_number ASC
      LIMIT 50
    `)
      .bind(
        likePattern,
        cleanLikePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern
      )
      .all();

    return new Response(
      JSON.stringify({
        query,
        count: (results || []).length,
        results: results || [],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Erreur interne' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
