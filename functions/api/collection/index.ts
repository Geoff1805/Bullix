interface Env {
  DB: D1Database;
}

interface CollectionItemInput {
  id?: string;
  user_id?: string;
  album_id: string;
  location_id?: string | null;
  condition?: string;
  edition_info?: string | null;
  purchase_price?: number | null;
  purchase_date?: string | null;
  notes?: string | null;
  is_favorite?: number | boolean;
  reading_status?: 'A_LIRE' | 'EN_COURS' | 'LU';
  is_wishlist?: number | boolean;
  loan_to?: string | null;
  loan_date?: string | null;
}

/**
 * API REST pour la gestion et la synchronisation de "Ma BDthèque"
 * Reliée en direct à Cloudflare D1 avec persistance instantanée et journal de synchro.
 */

// GET : Récupération de toute la collection de l'utilisateur
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id') || 'default_user';

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'D1 non lié' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // Récupération de la collection avec jointures complètes sur albums et séries
    const { results } = await env.DB.prepare(`
      SELECT 
        uc.id AS collection_id,
        uc.user_id,
        uc.album_id,
        uc.location_id,
        uc.condition,
        uc.edition_info,
        uc.purchase_price,
        uc.purchase_date,
        uc.notes,
        uc.is_favorite,
        uc.created_at,
        uc.updated_at,
        a.title AS album_title,
        a.volume_number,
        a.isbn,
        a.authors,
        a.publisher,
        a.published_year,
        a.cover_image_url,
        s.id AS series_id,
        s.title AS series_title,
        s.type AS series_type,
        s.status AS series_status,
        loc.name AS location_name
      FROM user_collection uc
      JOIN albums a ON uc.album_id = a.id
      JOIN series s ON a.series_id = s.id
      LEFT JOIN locations loc ON uc.location_id = loc.id
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL
      ORDER BY s.title ASC, a.volume_number ASC
    `)
      .bind(userId)
      .all();

    return new Response(
      JSON.stringify({
        user_id: userId,
        count: results?.length || 0,
        items: results || [],
        timestamp: Date.now(),
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
    return new Response(JSON.stringify({ error: error?.message || 'Erreur interne' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST : Ajout d'un album dans la collection
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const body = (await request.json()) as CollectionItemInput;

    if (!body || !body.album_id) {
      return new Response(JSON.stringify({ error: 'album_id obligatoire' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'D1 non lié' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const userId = body.user_id || 'default_user';
    const id = body.id || `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    // Insertion ou mise à jour dans user_collection
    await env.DB.prepare(`
      INSERT INTO user_collection (
        id, user_id, album_id, location_id, condition, edition_info,
        purchase_price, purchase_date, notes, is_favorite,
        created_at, updated_at, deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        location_id = excluded.location_id,
        condition = excluded.condition,
        edition_info = excluded.edition_info,
        purchase_price = excluded.purchase_price,
        notes = excluded.notes,
        is_favorite = excluded.is_favorite,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `)
      .bind(
        id,
        userId,
        body.album_id,
        body.location_id || null,
        body.condition || 'Bon',
        body.edition_info || 'Tirage standard',
        body.purchase_price || null,
        body.purchase_date || null,
        body.notes || null,
        body.is_favorite ? 1 : 0,
        now,
        now
      )
      .run();

    // Journalisation dans la table records pour la synchronisation
    await env.DB.prepare(`
      INSERT INTO records (id, user_id, entity_type, payload, sync_status, created_at, updated_at, deleted_at)
      VALUES (?, ?, 'user_collection', ?, 'SYNCED', ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        sync_status = 'SYNCED',
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `)
      .bind(
        id,
        userId,
        JSON.stringify({
          id,
          user_id: userId,
          album_id: body.album_id,
          location_id: body.location_id || null,
          condition: body.condition || 'Bon',
          notes: body.notes || null,
          is_favorite: body.is_favorite ? 1 : 0,
        }),
        now,
        now
      )
      .run();

    return new Response(JSON.stringify({ success: true, id, updated_at: now }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Erreur interne' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE : Retrait d'un album de la collection (Soft delete)
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const albumId = url.searchParams.get('album_id');
    const userId = url.searchParams.get('user_id') || 'default_user';

    if (!id && !albumId) {
      return new Response(JSON.stringify({ error: 'id ou album_id requis' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'D1 non lié' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const now = Date.now();

    if (id) {
      await env.DB.prepare('UPDATE user_collection SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .bind(now, now, id)
        .run();
      await env.DB.prepare('UPDATE records SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .bind(now, now, id)
        .run();
    } else if (albumId) {
      await env.DB.prepare('UPDATE user_collection SET deleted_at = ?, updated_at = ? WHERE album_id = ? AND user_id = ?')
        .bind(now, now, albumId, userId)
        .run();
      await env.DB.prepare('UPDATE records SET deleted_at = ?, updated_at = ? WHERE payload LIKE ? AND user_id = ?')
        .bind(now, now, `%"album_id":"${albumId}"%`, userId)
        .run();
    }

    return new Response(JSON.stringify({ success: true, deleted_at: now }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Erreur interne' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
