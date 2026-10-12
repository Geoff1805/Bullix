interface Env {
  IMAGES_BUCKET: R2Bucket;
}

/**
 * Endpoint de distribution d'images Cloudflare R2 Edge
 * Route Cloudflare Pages: GET /api/images/[[path]] (syntaxe catch-all Cloudflare)
 * Ex: /api/images/covers/alb_123.jpg
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { params, env } = context;
    const pathParam = params.path;
    const key = Array.isArray(pathParam) ? pathParam.join('/') : (pathParam as string);

    if (!key) {
      return new Response(JSON.stringify({ error: 'Chemin d\'image manquant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!env.IMAGES_BUCKET) {
      return new Response(JSON.stringify({ error: 'Binding IMAGES_BUCKET non configuré' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const object = await env.IMAGES_BUCKET.get(key);
    if (!object) {
      return new Response(JSON.stringify({ error: 'Image introuvable dans R2', key }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    if (!headers.get('Content-Type')) {
      headers.set('Content-Type', 'image/jpeg');
    }

    return new Response(object.body, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Erreur serveur R2' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
