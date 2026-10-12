import { cascadeLookup } from './services/metadata_providers';

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

    let localResults: any[] = [];

    // 1. Recherche dans Cloudflare D1
    if (env.DB) {
      try {
        const cleanQuery = query.replace(/[-\s]/g, '');
        const likePattern = `%${query}%`;
        const cleanLikePattern = `%${cleanQuery}%`;

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

        localResults = results || [];
      } catch (dbErr) {
        console.warn('[Search D1] Erreur D1:', dbErr);
      }
    }

    // 2. Si D1 renvoie des résultats, on les renvoie directement
    if (localResults.length > 0) {
      return new Response(
        JSON.stringify({
          query,
          source: 'bullix_d1',
          count: localResults.length,
          results: localResults,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
          },
        }
      );
    }

    // 3. Fallback cascade externe (BnF -> Google Books -> Open Library -> MangaDex)
    const isIsbn = /^[0-9Xx-]{9,17}$/.test(query);
    const externalResult = await cascadeLookup(query, isIsbn);

    if (externalResult) {
      const formattedResult = {
        album_id: externalResult.id,
        series_id: externalResult.series_id,
        volume_number: externalResult.volume_number,
        album_title: externalResult.title,
        isbn: externalResult.isbn,
        authors: externalResult.authors,
        publisher: externalResult.publisher,
        published_year: externalResult.published_year,
        cover_image_url: externalResult.cover_image_url,
        series_title: externalResult.series_title,
        series_type: externalResult.series_type,
        series_status: 'En cours',
      };

      // Auto-enregistrement transparent dans D1 si DB disponible
      if (env.DB) {
        try {
          await env.DB.prepare(`
            INSERT OR IGNORE INTO series (id, title, type, status, total_volumes, publisher_default)
            VALUES (?, ?, ?, 'En cours', ?, ?)
          `)
            .bind(
              externalResult.series_id,
              externalResult.series_title,
              externalResult.series_type,
              externalResult.volume_number,
              externalResult.publisher
            )
            .run();

          await env.DB.prepare(`
            INSERT OR IGNORE INTO albums (id, series_id, volume_number, title, isbn, authors, publisher, published_year, cover_image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
            .bind(
              externalResult.id,
              externalResult.series_id,
              externalResult.volume_number,
              externalResult.title,
              externalResult.isbn,
              externalResult.authors,
              externalResult.publisher,
              externalResult.published_year,
              externalResult.cover_image_url
            )
            .run();
        } catch (insertErr) {
          console.warn('[D1 Insert] Erreur insertion D1:', insertErr);
        }
      }

      return new Response(
        JSON.stringify({
          query,
          source: externalResult.source,
          count: 1,
          results: [formattedResult],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        query,
        count: 0,
        results: [],
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
