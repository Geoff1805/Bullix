import { cascadeLookup } from './services/metadata_providers';

interface Env {
  DB: D1Database;
  CACHE_KV: KVNamespace;
}

function getAccentVariants(word: string): string[] {
  const w = word.toLowerCase();
  const variants = new Set<string>();
  variants.add(w);

  const unaccented = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  variants.add(unaccented);

  const commonMap: Record<string, string[]> = {
    'asterix': ['astérix', 'asterix'],
    'astérix': ['astérix', 'asterix'],
    'epervier': ['épervier', 'epervier'],
    'eleve': ['élève', 'eleve'],
    'herge': ['hergé', 'herge'],
    'mystere': ['mystère', 'mystere'],
    'chateau': ['château', 'chateau'],
    'foret': ['forêt', 'foret'],
    'tresor': ['trésor', 'tresor'],
    'ocean': ['océan', 'ocean'],
    'planete': ['planète', 'planete'],
  };

  if (commonMap[unaccented]) {
    commonMap[unaccented].forEach((v) => variants.add(v));
  } else {
    if (unaccented.includes('e')) {
      variants.add(unaccented.replace(/e/g, 'é'));
      variants.add(unaccented.replace(/e/g, 'è'));
    }
    if (unaccented.includes('a')) {
      variants.add(unaccented.replace(/a/g, 'â'));
    }
  }

  return Array.from(variants);
}

function buildSearchCondition(query: string): { sql: string; params: (string | number)[] } {
  const cleanIsbn = query.replace(/[-\s]/g, '');
  if (/^[0-9Xx]{9,17}$/.test(cleanIsbn)) {
    return {
      sql: '(a.isbn LIKE ? OR a.upc LIKE ?)',
      params: [`%${cleanIsbn}%`, `%${cleanIsbn}%`],
    };
  }

  const rawTokens = query.trim().split(/\s+/).filter((t) => t.length > 0);
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  for (const token of rawTokens) {
    const volMatch = token.match(/^(?:tome|vol|volume|t\.?)?(\d+(?:\.\d+)?)$/i);
    if (volMatch && (rawTokens.length > 1 || /^(?:tome|vol|volume|t\.)/i.test(token))) {
      const volNum = parseFloat(volMatch[1]);
      clauses.push('(a.volume_number = ? OR CAST(a.volume_number AS TEXT) LIKE ?)');
      params.push(volNum, `%${volMatch[1]}%`);
      continue;
    }

    const variants = getAccentVariants(token);
    const subClauses: string[] = [];
    for (const v of variants) {
      subClauses.push(
        '(s.title LIKE ? OR a.title LIKE ? OR a.authors LIKE ? OR a.publisher LIKE ? OR a.isbn LIKE ? OR s.type LIKE ?)'
      );
      const pat = `%${v}%`;
      params.push(pat, pat, pat, pat, pat, pat);
    }

    clauses.push(`(${subClauses.join(' OR ')})`);
  }

  return {
    sql: clauses.length > 0 ? clauses.join(' AND ') : '1=1',
    params,
  };
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

    // 1. Recherche tolérante aux accents & multi-mots dans Cloudflare D1
    if (env.DB) {
      try {
        const { sql: searchSql, params: searchParams } = buildSearchCondition(query);

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
          WHERE a.deleted_at IS NULL AND (${searchSql})
          ORDER BY s.title ASC, a.volume_number ASC
          LIMIT 50
        `)
          .bind(...searchParams)
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
