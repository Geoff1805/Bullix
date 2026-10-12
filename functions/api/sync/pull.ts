interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id');
    const since = parseInt(url.searchParams.get('since') || '0', 10);

    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id requis' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { results } = await env.DB.prepare(
      'SELECT id, user_id, entity_type, payload, updated_at, deleted_at FROM records WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500'
    )
      .bind(userId, since)
      .all();

    return new Response(
      JSON.stringify({
        records: results || [],
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
