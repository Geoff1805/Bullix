interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id') || 'default_user';
    const since = parseInt(url.searchParams.get('since') || '0', 10);

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'DB non liée' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const { results } = await env.DB.prepare(
      'SELECT id, user_id, entity_type, payload, updated_at, deleted_at FROM records WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500'
    )
      .bind(userId, since)
      .all();

    let records = results || [];

    // Si aucun record dans le journal (ex: collection créée avant le journal), on génère les records depuis user_collection
    if (records.length === 0 && since === 0) {
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

    return new Response(
      JSON.stringify({
        records,
        server_timestamp: Date.now(),
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
