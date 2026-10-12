import { cascadeLookup } from './services/metadata_providers';

interface Env {
  DB: D1Database;
  CACHE_KV: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const rawIsbn = url.searchParams.get('isbn');

    if (!rawIsbn) {
      return new Response(JSON.stringify({ error: 'Paramètre isbn manquant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanIsbn = rawIsbn.replace(/[-\s]/g, '');

    // =========================================================================
    // 1. RECHERCHE PRIORITAIRE : Base Cloudflare D1 Bullix
    // =========================================================================
    if (env.DB) {
      try {
        const albumInD1 = await env.DB.prepare(`
          SELECT a.id, a.series_id, a.volume_number, a.title, a.isbn, a.authors, a.publisher,
                 a.published_year, a.cover_image_url,
                 s.title AS series_title, s.type AS series_type, s.status AS series_status,
                 s.total_volumes AS series_total_volumes
          FROM albums a
          LEFT JOIN series s ON a.series_id = s.id
          WHERE a.isbn = ?
          LIMIT 1
        `)
          .bind(cleanIsbn)
          .first<any>();

        if (albumInD1) {
          // Rapatriement de TOUS les tomes de la série pour le cache prédictif mobile
          const seriesAlbums = await env.DB.prepare(`
            SELECT id, series_id, volume_number, title, isbn, cover_image_url, authors, publisher, published_year
            FROM albums
            WHERE series_id = ?
            ORDER BY volume_number ASC
          `)
            .bind(albumInD1.series_id)
            .all();

          return new Response(
            JSON.stringify({
              source: 'bullix_d1',
              album: {
                id: albumInD1.id,
                series_id: albumInD1.series_id,
                volume_number: albumInD1.volume_number,
                title: albumInD1.title,
                isbn: albumInD1.isbn,
                authors: albumInD1.authors,
                publisher: albumInD1.publisher,
                published_year: albumInD1.published_year,
                cover_image_url: albumInD1.cover_image_url,
              },
              series: {
                id: albumInD1.series_id,
                title: albumInD1.series_title,
                type: albumInD1.series_type,
                status: albumInD1.series_status,
                total_volumes: albumInD1.series_total_volumes,
              },
              series_albums: seriesAlbums.results || [],
              cache_instruction: {
                action: 'CACHE_ENTIRE_SERIES',
                series_id: albumInD1.series_id,
                count: (seriesAlbums.results || []).length,
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      } catch (dbErr) {
        console.warn('[D1 Lookup] Erreur D1:', dbErr);
      }
    }

    // =========================================================================
    // 2. VÉRIFICATION DU CACHE KV (Requêtes récentes)
    // =========================================================================
    const cacheKey = `isbn:${cleanIsbn}`;
    if (env.CACHE_KV) {
      try {
        const cached = await env.CACHE_KV.get(cacheKey, 'json');
        if (cached) {
          return new Response(JSON.stringify(cached), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (kvErr) {
        console.warn('[KV Cache] Erreur lecture KV:', kvErr);
      }
    }

    // =========================================================================
    // 3. PIPELINE EN CASCADE (BnF SRU -> Google Books -> Open Library)
    // =========================================================================
    const externalResult = await cascadeLookup(cleanIsbn, true);

    if (externalResult) {
      const responsePayload = {
        source: externalResult.source,
        album: {
          id: externalResult.id,
          series_id: externalResult.series_id,
          volume_number: externalResult.volume_number,
          title: externalResult.title,
          isbn: externalResult.isbn,
          authors: externalResult.authors,
          publisher: externalResult.publisher,
          published_year: externalResult.published_year,
          cover_image_url: externalResult.cover_image_url,
        },
        series: {
          id: externalResult.series_id,
          title: externalResult.series_title,
          type: externalResult.series_type,
          status: 'En cours',
          total_volumes: externalResult.volume_number,
        },
        series_albums: [
          {
            id: externalResult.id,
            series_id: externalResult.series_id,
            volume_number: externalResult.volume_number,
            title: externalResult.title,
            isbn: externalResult.isbn,
            authors: externalResult.authors,
            publisher: externalResult.publisher,
            published_year: externalResult.published_year,
            cover_image_url: externalResult.cover_image_url,
          }
        ],
      };

      // Mise en cache KV (30 jours)
      if (env.CACHE_KV) {
        try {
          await env.CACHE_KV.put(cacheKey, JSON.stringify(responsePayload), {
            expirationTtl: 86400 * 30,
          });
        } catch (kvPutErr) {
          console.warn('[KV Cache] Erreur écriture KV:', kvPutErr);
        }
      }

      // Auto-enrichissement transparent de Cloudflare D1
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
        } catch (d1InsertErr) {
          console.warn('[D1 Auto-Insert] Erreur insertion D1:', d1InsertErr);
        }
      }

      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Album introuvable', isbn: cleanIsbn }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Erreur interne' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
