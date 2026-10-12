interface Env {
  DB: D1Database;
  CACHE_KV?: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const rawLimit = parseInt(url.searchParams.get('limit') || '24', 10);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 24 : rawLimit));
    const offset = (page - 1) * limit;

    const query = url.searchParams.get('q')?.trim() || '';
    const seriesId = url.searchParams.get('series_id')?.trim() || '';

    if (!env.DB) {
      return new Response(
        JSON.stringify({
          page,
          limit,
          total: 0,
          totalPages: 0,
          albums: [],
          notice: 'Base D1 non disponible sur cet environnement',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    let countSql = `
      SELECT COUNT(*) AS total
      FROM albums a
      LEFT JOIN series s ON a.series_id = s.id
      WHERE a.deleted_at IS NULL
    `;
    let dataSql = `
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
      WHERE a.deleted_at IS NULL
    `;

    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    if (seriesId) {
      whereClauses.push('a.series_id = ?');
      params.push(seriesId);
    }

    if (query) {
      const cleanQuery = query.replace(/[-\s]/g, '');
      const likePattern = `%${query}%`;
      const cleanLikePattern = `%${cleanQuery}%`;

      whereClauses.push(`(
        a.title LIKE ? OR
        a.isbn LIKE ? OR
        a.isbn LIKE ? OR
        a.authors LIKE ? OR
        a.publisher LIKE ? OR
        s.title LIKE ? OR
        s.type LIKE ? OR
        CAST(a.published_year AS TEXT) LIKE ? OR
        CAST(a.volume_number AS TEXT) LIKE ?
      )`);
      params.push(
        likePattern,
        cleanLikePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern
      );
    }

    if (whereClauses.length > 0) {
      const extraWhere = ' AND ' + whereClauses.join(' AND ');
      countSql += extraWhere;
      dataSql += extraWhere;
    }

    dataSql += ' ORDER BY s.title ASC, a.volume_number ASC LIMIT ? OFFSET ?';

    const countResult = await env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    const dataParams = [...params, limit, offset];
    const { results } = await env.DB.prepare(dataSql).bind(...dataParams).all();

    return new Response(
      JSON.stringify({
        page,
        limit,
        total,
        totalPages,
        albums: results || [],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=30, s-maxage=60',
        },
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
