interface Env {
  DB: D1Database;
  CACHE_KV?: KVNamespace;
}

const DEFAULT_SAMPLE_ITEMS = [
  {
    collection_id: "col_1",
    album_id: "bd-1",
    series_id: "ser_asterix",
    series_title: "Astérix",
    series_type: "Franco-belge",
    volume_number: 1,
    album_title: "Astérix le Gaulois",
    isbn: "9782012101333",
    authors: "René Goscinny, Albert Uderzo",
    publisher: "Dargaud",
    published_year: 1961,
    location_id: "loc_salon_b1_c01",
    location_name: "Salon › Bibliothèque",
    condition: "Très bon",
    edition_info: "Édition Originale",
    purchase_price: 12.0,
    is_favorite: 1,
    notes: '{"readingStatus":"LU"}',
    cover_image_url: "https://covers.openlibrary.org/b/isbn/9782012101333-M.jpg"
  },
  {
    collection_id: "col_2",
    album_id: "bd-2",
    series_id: "ser_blacksad",
    series_title: "Blacksad",
    series_type: "Franco-belge",
    volume_number: 1,
    album_title: "Quelque part entre les ombres",
    isbn: "9782205049657",
    authors: "Juan Díaz Canales, Juanjo Guarnido",
    publisher: "Dargaud",
    published_year: 2000,
    location_id: "loc_salon_b1_c01",
    location_name: "Salon › Bibliothèque",
    condition: "Neuf",
    edition_info: "Tirage courant",
    purchase_price: 15.0,
    is_favorite: 0,
    notes: '{"readingStatus":"EN_COURS"}',
    cover_image_url: "https://covers.openlibrary.org/b/isbn/9782205049657-M.jpg"
  },
  {
    collection_id: "col_3",
    album_id: "bd-3",
    series_id: "ser_tintin",
    series_title: "Tintin",
    series_type: "Franco-belge",
    volume_number: 5,
    album_title: "Le Lotus bleu",
    isbn: "9782203001046",
    authors: "Hergé",
    publisher: "Casterman",
    published_year: 1946,
    location_id: null,
    location_name: null,
    condition: "Bon",
    edition_info: "Fac-similé",
    purchase_price: 10.0,
    is_favorite: 0,
    notes: '{"readingStatus":"LU","loanTo":"Alexandre"}',
    cover_image_url: "https://covers.openlibrary.org/b/isbn/9782203001046-M.jpg"
  },
  {
    collection_id: "col_4",
    album_id: "bd-4",
    series_id: "ser_one_piece",
    series_title: "One Piece",
    series_type: "Manga",
    volume_number: 1,
    album_title: "Romance Dawn",
    isbn: "9782723488525",
    authors: "Eiichiro Oda",
    publisher: "Glénat",
    published_year: 1997,
    location_id: "loc_bureau_pile_a_ranger",
    location_name: "Bureau › Tour Manga",
    condition: "Très bon",
    edition_info: "Tirage standard",
    purchase_price: 7.0,
    is_favorite: 0,
    notes: '{"readingStatus":"A_LIRE"}',
    cover_image_url: "https://covers.openlibrary.org/b/isbn/9782723488525-M.jpg"
  }
];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id') || 'default_user';
    const since = parseInt(url.searchParams.get('since') || '0', 10);

    let records: any[] = [];

    // 1. Tenter la lecture dans Cloudflare D1
    if (env.DB) {
      try {
        const { results } = await env.DB.prepare(
          'SELECT id, user_id, entity_type, payload, updated_at, deleted_at FROM records WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500'
        )
          .bind(userId, since)
          .all();

        if (results && results.length > 0) {
          records = results;
        } else if (since === 0) {
          // Si journal vide, reconstruire depuis user_collection
          const { results: existingColl } = await env.DB.prepare(`
            SELECT uc.id, uc.user_id, uc.album_id, uc.location_id, uc.condition, uc.edition_info,
                   uc.purchase_price, uc.notes, uc.is_favorite, uc.updated_at, uc.deleted_at,
                   a.title AS album_title, a.volume_number, a.isbn, a.authors, a.publisher, a.published_year, a.cover_image_url,
                   COALESCE(s.id, a.series_id) AS series_id, s.title AS series_title, s.type AS series_type
            FROM user_collection uc
            LEFT JOIN albums a ON uc.album_id = a.id
            LEFT JOIN series s ON a.series_id = s.id
            WHERE uc.user_id = ? AND uc.deleted_at IS NULL
          `)
            .bind(userId)
            .all<any>();

          if (existingColl && existingColl.length > 0) {
            records = existingColl.map(item => ({
              id: item.id,
              user_id: item.user_id,
              entity_type: 'user_collection',
              payload: JSON.stringify({
                id: item.id,
                album_id: item.album_id,
                location_id: item.location_id,
                condition: item.condition,
                edition_info: item.edition_info,
                purchase_price: item.purchase_price,
                notes: item.notes,
                is_favorite: item.is_favorite === 1,
                album_title: item.album_title,
                volume_number: item.volume_number,
                isbn: item.isbn,
                authors: item.authors,
                publisher: item.publisher,
                published_year: item.published_year,
                cover_image_url: item.cover_image_url,
                series_id: item.series_id,
                series_title: item.series_title,
                series_type: item.series_type,
              }),
              updated_at: item.updated_at,
              deleted_at: item.deleted_at,
            }));
          }
        }
      } catch (d1Err) {
        console.warn('[D1 sync/pull warning]', d1Err);
      }
    }

    // 2. Si D1 n'a rien renvoyé, chercher dans KV Namespace
    if (records.length === 0 && env.CACHE_KV) {
      try {
        const kvRecords = await env.CACHE_KV.get(`bullix_sync_records_${userId}`, 'json') as any[];
        if (kvRecords && Array.isArray(kvRecords) && kvRecords.length > 0) {
          records = kvRecords.filter(r => r.updated_at > since);
        } else if (since === 0) {
          const kvCollection = await env.CACHE_KV.get(`bullix_collection_${userId}`, 'json') as any[];
          if (kvCollection && Array.isArray(kvCollection) && kvCollection.length > 0) {
            records = kvCollection.map(item => ({
              id: item.collection_id || item.id,
              user_id: userId,
              entity_type: 'user_collection',
              payload: JSON.stringify(item),
              updated_at: item.updated_at || Date.now(),
              deleted_at: item.deleted_at || null
            }));
          }
        }
      } catch (kvErr) {
        console.warn('[KV sync/pull warning]', kvErr);
      }
    }

    // 3. Fallback d'amorce par défaut si vide pour default_user
    if (records.length === 0 && userId === 'default_user' && since === 0) {
      const now = Date.now();
      records = DEFAULT_SAMPLE_ITEMS.map(item => ({
        id: item.collection_id,
        user_id: userId,
        entity_type: 'user_collection',
        payload: JSON.stringify(item),
        updated_at: now,
        deleted_at: null
      }));
    }

    return new Response(
      JSON.stringify({
        records,
        server_timestamp: Date.now(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
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
