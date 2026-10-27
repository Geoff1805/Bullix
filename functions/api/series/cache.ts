interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const seriesId = url.searchParams.get('series_id');

    if (!seriesId) {
      return new Response(JSON.stringify({ error: 'series_id requis' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const series = await env.DB.prepare(`
      SELECT * FROM series WHERE id = ? LIMIT 1
    `)
      .bind(seriesId)
      .first<any>();

    if (!series) {
      return new Response(JSON.stringify({ error: 'Série introuvable', series_id: seriesId }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { results: albums } = await env.DB.prepare(`
      SELECT id, series_id, volume_number, title, isbn, upc, authors, publisher, published_year, cover_image_url
      FROM albums
      WHERE series_id = ?
      ORDER BY volume_number ASC
    `)
      .bind(seriesId)
      .all();

    return new Response(
      JSON.stringify({
        series,
        albums: albums || [],
        count: (albums || []).length,
        timestamp: Date.now(),
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
