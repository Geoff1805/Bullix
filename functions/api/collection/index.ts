interface Env {
  DB: D1Database;
  CACHE_KV?: KVNamespace;
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
  album_title?: string;
  series_title?: string;
  series_id?: string;
  series_type?: string;
  volume_number?: number;
  authors?: string;
  publisher?: string;
  published_year?: number;
  isbn?: string;
  cover_image_url?: string;
}

// Données d'amorce standard de démonstration
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

/**
 * API REST pour la gestion et la synchronisation de "Ma BDthèque"
 * Double persistance résiliente : Cloudflare D1 + KV Namespace fallback.
 */

// GET : Récupération de toute la collection de l'utilisateur
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id') || 'default_user';

    let items: any[] = [];

    // 1. Tentative de lecture prioritaire depuis Cloudflare D1
    if (env.DB) {
      try {
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
            COALESCE(a.title, 'Album ' || uc.album_id) AS album_title,
            COALESCE(a.volume_number, 1) AS volume_number,
            a.isbn,
            a.authors,
            a.publisher,
            a.published_year,
            a.cover_image_url,
            COALESCE(s.id, a.series_id, 'series_inconnue') AS series_id,
            COALESCE(s.title, 'Sans série') AS series_title,
            COALESCE(s.type, 'Franco-belge') AS series_type,
            COALESCE(s.status, 'En cours') AS series_status,
            loc.name AS location_name
          FROM user_collection uc
          LEFT JOIN albums a ON uc.album_id = a.id
          LEFT JOIN series s ON a.series_id = s.id
          LEFT JOIN locations loc ON uc.location_id = loc.id
          WHERE uc.user_id = ? AND uc.deleted_at IS NULL
          ORDER BY COALESCE(s.title, a.title, 'Sans titre') ASC, a.volume_number ASC
        `)
          .bind(userId)
          .all();

        if (results && results.length > 0) {
          items = results;
        }
      } catch (d1Err) {
        console.warn('[D1 collection GET error]', d1Err);
      }
    }

    // 2. Si D1 est vide ou indisponible, tentative de lecture depuis KV Namespace
    if (items.length === 0 && env.CACHE_KV) {
      try {
        const kvData = await env.CACHE_KV.get(`bullix_collection_${userId}`, 'json') as any[];
        if (kvData && Array.isArray(kvData) && kvData.length > 0) {
          items = kvData.filter(i => !i.deleted_at);
        }
      } catch (kvErr) {
        console.warn('[KV collection GET error]', kvErr);
      }
    }

    // 3. Si toujours vide pour l'utilisateur par défaut, servir l'amorce par défaut
    if (items.length === 0 && userId === 'default_user') {
      items = DEFAULT_SAMPLE_ITEMS;
      // Persister dans KV pour que les prochaines synchronisations soient instantanées
      if (env.CACHE_KV) {
        env.CACHE_KV.put(`bullix_collection_${userId}`, JSON.stringify(items)).catch(() => {});
      }
    }

    return new Response(
      JSON.stringify({
        user_id: userId,
        count: items.length,
        items: items,
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

    const userId = body.user_id || 'default_user';
    const id = body.id || `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    const sId = body.series_id || (body.series_title ? `ser_${body.series_title.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30)}` : `ser_${body.album_id}`);

    let d1Success = false;

    // 1. Insertion résiliente dans Cloudflare D1
    if (env.DB) {
      try {
        // Auto-création de l'emplacement si spécifié pour éviter SQLITE_CONSTRAINT_FOREIGNKEY
        if (body.location_id) {
          await env.DB.prepare(`
            INSERT INTO locations (id, user_id, name, qr_code_ref, color_tag, created_at, updated_at)
            VALUES (?, ?, 'Emplacement importé', NULL, '#4CAF50', ?, ?)
            ON CONFLICT(id) DO NOTHING
          `).bind(body.location_id, userId, now, now).run().catch(() => {});
        }

        // Auto-création de la série
        await env.DB.prepare(`
          INSERT INTO series (id, title, type, status, created_at, updated_at)
          VALUES (?, ?, ?, 'En cours', ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).bind(sId, body.series_title || 'Sans série', body.series_type || 'Franco-belge', now, now).run().catch(() => {});

        // Auto-création ou mise à jour de l'album
        await env.DB.prepare(`
          INSERT INTO albums (id, series_id, volume_number, title, isbn, authors, publisher, published_year, cover_image_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = COALESCE(excluded.title, albums.title),
            cover_image_url = COALESCE(excluded.cover_image_url, albums.cover_image_url),
            updated_at = excluded.updated_at
        `).bind(
          body.album_id,
          sId,
          body.volume_number || 1,
          body.album_title || 'Album',
          body.isbn || null,
          body.authors || null,
          body.publisher || null,
          body.published_year || null,
          body.cover_image_url || null,
          now,
          now
        ).run().catch(() => {});

        // Insertion dans user_collection
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

        // Journalisation dans la table records
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
              album_title: body.album_title || 'Album',
              series_title: body.series_title || 'Sans série',
              series_id: sId,
              series_type: body.series_type || 'Franco-belge',
              volume_number: body.volume_number || 1,
              authors: body.authors || null,
              publisher: body.publisher || null,
              published_year: body.published_year || null,
              cover_image_url: body.cover_image_url || null,
              isbn: body.isbn || null,
            }),
            now,
            now
          )
          .run().catch(() => {});

        d1Success = true;
      } catch (d1Err) {
        console.warn('[D1 collection POST fallback to KV]', d1Err);
      }
    }

    // 2. Sauvegarde résiliente dans Cloudflare KV Namespace (garantie même si D1 est en quota dépassé)
    if (env.CACHE_KV) {
      try {
        const rawKv = (await env.CACHE_KV.get(`bullix_collection_${userId}`, 'json') as any[]) || [...DEFAULT_SAMPLE_ITEMS];
        const filtered = rawKv.filter((x: any) => x.collection_id !== id && x.album_id !== body.album_id);
        const newItem = {
          collection_id: id,
          user_id: userId,
          album_id: body.album_id,
          location_id: body.location_id || null,
          location_name: body.location_id ? 'Salon' : null,
          condition: body.condition || 'Bon',
          edition_info: body.edition_info || 'Tirage standard',
          purchase_price: body.purchase_price || null,
          purchase_date: body.purchase_date || null,
          notes: body.notes || null,
          is_favorite: body.is_favorite ? 1 : 0,
          album_title: body.album_title || 'Album',
          series_title: body.series_title || 'Sans série',
          series_id: sId,
          series_type: body.series_type || 'Franco-belge',
          volume_number: body.volume_number || 1,
          authors: body.authors || null,
          publisher: body.publisher || null,
          published_year: body.published_year || null,
          cover_image_url: body.cover_image_url || null,
          isbn: body.isbn || null,
          created_at: now,
          updated_at: now,
        };
        filtered.push(newItem);
        await env.CACHE_KV.put(`bullix_collection_${userId}`, JSON.stringify(filtered));

        // Mise à jour du journal de synchronisation KV pour /api/sync/pull
        const rawRecords = (await env.CACHE_KV.get(`bullix_sync_records_${userId}`, 'json') as any[]) || [];
        const recordFiltered = rawRecords.filter((r: any) => r.id !== id);
        recordFiltered.push({
          id,
          user_id: userId,
          entity_type: 'user_collection',
          payload: JSON.stringify(newItem),
          updated_at: now,
          deleted_at: null
        });
        await env.CACHE_KV.put(`bullix_sync_records_${userId}`, JSON.stringify(recordFiltered));
      } catch (kvErr) {
        console.warn('[KV collection write error]', kvErr);
      }
    }

    return new Response(JSON.stringify({ success: true, id, updated_at: now, d1_synced: d1Success }), {
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

    const now = Date.now();

    // 1. Soft delete D1
    if (env.DB) {
      try {
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
      } catch (d1Err) {
        console.warn('[D1 delete warning]', d1Err);
      }
    }

    // 2. Soft delete KV
    if (env.CACHE_KV) {
      try {
        const rawKv = (await env.CACHE_KV.get(`bullix_collection_${userId}`, 'json') as any[]) || [];
        const updated = rawKv.filter((x: any) => {
          if (id && (x.collection_id === id || x.id === id)) return false;
          if (albumId && x.album_id === albumId) return false;
          return true;
        });
        await env.CACHE_KV.put(`bullix_collection_${userId}`, JSON.stringify(updated));

        // Enregistrer la suppression dans le journal sync KV
        const rawRecords = (await env.CACHE_KV.get(`bullix_sync_records_${userId}`, 'json') as any[]) || [];
        rawRecords.push({
          id: id || `del_${Date.now()}`,
          user_id: userId,
          entity_type: 'user_collection',
          payload: JSON.stringify({ album_id: albumId, id }),
          updated_at: now,
          deleted_at: now
        });
        await env.CACHE_KV.put(`bullix_sync_records_${userId}`, JSON.stringify(rawRecords));
      } catch (kvErr) {
        console.warn('[KV delete warning]', kvErr);
      }
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
