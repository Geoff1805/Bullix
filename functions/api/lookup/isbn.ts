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
    // 1. RECHERCHE PRIORITAIRE : Base Online Bullix D1 (Pré-remplie BDthèque + BDvore)
    // =========================================================================
    if (env.DB) {
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
    }

    // =========================================================================
    // 2. VÉRIFICATION DU CACHE KV (Requêtes récentes)
    // =========================================================================
    const cacheKey = `isbn:${cleanIsbn}`;
    if (env.CACHE_KV) {
      const cached = await env.CACHE_KV.get(cacheKey, 'json');
      if (cached) {
        return new Response(JSON.stringify({ source: 'cache_kv', data: cached }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // =========================================================================
    // 3. CASCADE SECOURS 1 : BnF SRU API (Dépôt légal officiel FR)
    // =========================================================================
    const bnfUrl = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=bib.isbn%20all%20%22${cleanIsbn}%22&recordSchema=dublincore&maximumRecords=1`;
    try {
      const bnfResp = await fetch(bnfUrl);
      if (bnfResp.ok) {
        const xml = await bnfResp.text();
        if (xml.includes('<dc:title>')) {
          const titleMatch = xml.match(/<dc:title>(.*?)<\/dc:title>/);
          const creatorMatch = xml.match(/<dc:creator>(.*?)<\/dc:creator>/);
          const publisherMatch = xml.match(/<dc:publisher>(.*?)<\/dc:publisher>/);
          const dateMatch = xml.match(/<dc:date>(.*?)<\/dc:date>/);

          const result = {
            isbn: cleanIsbn,
            title: titleMatch ? titleMatch[1] : null,
            authors: creatorMatch ? creatorMatch[1] : null,
            publisher: publisherMatch ? publisherMatch[1] : null,
            published_year: dateMatch ? parseInt(dateMatch[1], 10) : null,
            cover_image_url: `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-L.jpg`,
            source: 'bnf',
          };

          if (env.CACHE_KV) {
            await env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 * 30 });
          }

          return new Response(JSON.stringify({ source: 'bnf', data: result }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    } catch (e) {
      // Poursuite vers Open Library en cas d'erreur
    }

    // =========================================================================
    // 4. CASCADE SECOURS 2 : Open Library API
    // =========================================================================
    const openLibUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanIsbn}&format=json&jscmd=data`;
    const openLibResp = await fetch(openLibUrl);
    if (openLibResp.ok) {
      const olData: any = await openLibResp.json();
      const bookData = olData[`ISBN:${cleanIsbn}`];
      if (bookData) {
        const result = {
          isbn: cleanIsbn,
          title: bookData.title,
          authors: bookData.authors?.map((a: any) => a.name).join(', ') || null,
          publisher: bookData.publishers?.map((p: any) => p.name).join(', ') || null,
          published_year: bookData.publish_date ? parseInt(bookData.publish_date, 10) : null,
          cover_image_url: bookData.cover?.large || `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-L.jpg`,
          source: 'openlibrary',
        };

        if (env.CACHE_KV) {
          await env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 * 30 });
        }

        return new Response(JSON.stringify({ source: 'openlibrary', data: result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
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
