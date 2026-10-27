interface Env {
  DB: D1Database;
  CACHE_KV?: KVNamespace;
}

/**
 * Génère des variantes avec et sans accents pour garantir le matching dans SQLite D1
 */
function getAccentVariants(word: string): string[] {
  const w = word.toLowerCase();
  const variants = new Set<string>();
  variants.add(w);

  // Forme sans accent
  const unaccented = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  variants.add(unaccented);

  // Mots fréquents de la BD franco-belge
  const commonMap: Record<string, string[]> = {
    'asterix': ['astérix', 'asterix'],
    'astérix': ['astérix', 'asterix'],
    'epervier': ['épervier', 'epervier'],
    'eleve': ['élève', 'eleve'],
    'herge': ['hergé', 'herge'],
    'franquin': ['franquin'],
    'franco': ['franco'],
    'belge': ['belge'],
    'theque': ['thèque', 'theque'],
    'bdtheque': ['bdthèque', 'bdtheque'],
    'cle': ['clé', 'cle'],
    'mystere': ['mystère', 'mystere'],
    'chateau': ['château', 'chateau'],
    'foret': ['forêt', 'foret'],
    'tresor': ['trésor', 'tresor'],
    'reine': ['reine'],
    'ocean': ['océan', 'ocean'],
    'planete': ['planète', 'planete'],
  };

  if (commonMap[unaccented]) {
    commonMap[unaccented].forEach((v) => variants.add(v));
  } else {
    // Remplacement heuristique e -> é
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

/**
 * Construit une clause WHERE résiliente : multi-termes, tomes combinés, sans blocage d'accents
 */
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
    // Détection de tome / volume explicite (ex: "tome 2", "t4", "vol.3", ou juste "2" si combiné)
    const volMatch = token.match(/^(?:tome|vol|volume|t\.?)?(\d+(?:\.\d+)?)$/i);
    if (volMatch && (rawTokens.length > 1 || /^(?:tome|vol|volume|t\.)/i.test(token))) {
      const volNum = parseFloat(volMatch[1]);
      clauses.push('(a.volume_number = ? OR CAST(a.volume_number AS TEXT) LIKE ?)');
      params.push(volNum, `%${volMatch[1]}%`);
      continue;
    }

    // Recherche multi-champs avec variantes d'accents
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

    if (url.searchParams.get('facets') === '1') {
      const types = await env.DB.prepare(
        "SELECT DISTINCT type AS v FROM series WHERE type IS NOT NULL AND type <> '' ORDER BY type"
      ).all();
      const publishers = await env.DB.prepare(
        "SELECT publisher AS v, COUNT(*) AS n FROM albums WHERE deleted_at IS NULL AND publisher IS NOT NULL AND publisher <> '' GROUP BY publisher ORDER BY n DESC LIMIT 100"
      ).all();
      const statuses = await env.DB.prepare(
        "SELECT DISTINCT status AS v FROM series WHERE status IS NOT NULL AND status <> '' ORDER BY status"
      ).all();
      return new Response(
        JSON.stringify({
          types: (types.results || []).map((r: any) => r.v),
          publishers: (publishers.results || []).map((r: any) => r.v).sort((a: string, b: string) => a.localeCompare(b, 'fr')),
          statuses: (statuses.results || []).map((r: any) => r.v),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } }
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
      const { sql: searchSql, params: searchParams } = buildSearchCondition(query);
      whereClauses.push(searchSql);
      params.push(...searchParams);
    }

    // Filtres avancés
    const type = url.searchParams.get('type')?.trim() || '';
    if (type) {
      whereClauses.push('s.type = ?');
      params.push(type);
    }
    const seriesStatus = url.searchParams.get('series_status')?.trim() || '';
    if (seriesStatus) {
      whereClauses.push('s.status = ?');
      params.push(seriesStatus);
    }
    const publisher = url.searchParams.get('publisher')?.trim() || '';
    if (publisher) {
      whereClauses.push('a.publisher = ?');
      params.push(publisher);
    }
    const yearFrom = parseInt(url.searchParams.get('year_from') || '', 10);
    if (!isNaN(yearFrom)) {
      whereClauses.push('a.published_year >= ?');
      params.push(yearFrom);
    }
    const yearTo = parseInt(url.searchParams.get('year_to') || '', 10);
    if (!isNaN(yearTo)) {
      whereClauses.push('a.published_year <= ?');
      params.push(yearTo);
    }
    const cover = url.searchParams.get('cover');
    if (cover === '1') {
      whereClauses.push("a.cover_image_url IS NOT NULL AND a.cover_image_url <> ''");
    } else if (cover === '0') {
      whereClauses.push("(a.cover_image_url IS NULL OR a.cover_image_url = '')");
    }
    const firstVolume = url.searchParams.get('first_volume');
    if (firstVolume === '1') {
      whereClauses.push('(a.volume_number = 1 OR a.volume_number IS NULL)');
    }

    if (whereClauses.length > 0) {
      const extraWhere = ' AND ' + whereClauses.join(' AND ');
      countSql += extraWhere;
      dataSql += extraWhere;
    }

    // Tri (liste blanche : pas d'injection SQL)
    const sortMap: Record<string, string> = {
      series: 's.title ASC, a.volume_number ASC',
      series_desc: 's.title DESC, a.volume_number ASC',
      title: 'a.title ASC',
      title_desc: 'a.title DESC',
      year_desc: 'a.published_year DESC, s.title ASC, a.volume_number ASC',
      year_asc: 'a.published_year ASC, s.title ASC, a.volume_number ASC',
      volume_asc: 'a.volume_number ASC, s.title ASC',
      volume_desc: 'a.volume_number DESC, s.title ASC',
    };
    const orderBy = sortMap[url.searchParams.get('sort') || ''] || sortMap.series;
    dataSql += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;

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
