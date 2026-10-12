interface Env {
  IMAGES_BUCKET: R2Bucket;
}

/**
 * Endpoint de distribution d'images Cloudflare R2 Edge
 * Route: GET /api/images/covers/:filename ou /api/images/:path
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { params, env } = context;
    const pathArray = params.path;
    const key = Array.isArray(pathArray) ? pathArray.join('/') : (pathArray as string);

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
