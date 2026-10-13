interface Env {
  DB?: D1Database;
  IMAGES_BUCKET: R2Bucket;
}

/**
 * Cloudflare Edge Image Caching & Proxy pour Bullix
 * 
 * Stratégie Edge Cache-Through (zéro charge locale PC) :
 * 1. Vérifie si l'image est déjà dans Cloudflare R2 (bullix-images).
 * 2. Si absente, extrait l'identifiant d'album, recherche la jaquette externe dans Cloudflare D1
 *    (ou depuis le paramètre ?src= / ?url=).
 * 3. Télécharge l'image depuis la source externe sur la dorsale Cloudflare.
 * 4. L'enregistre automatiquement dans le bucket R2.
 * 5. La renvoie au client avec cache HTTP immuable.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { params, env, request } = context;
    const reqUrl = new URL(request.url);
    const pathParam = params.path;
    const key = Array.isArray(pathParam) ? pathParam.join('/') : (pathParam as string);

    // Support du proxy direct avec URL externe : /api/images/proxy?url=https://...
    const directUrl = reqUrl.searchParams.get('url') || reqUrl.searchParams.get('src');

    if (!key && !directUrl) {
      return new Response(JSON.stringify({ error: 'Chemin d\'image ou URL manquant' }), {
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

    // 1. Recherche dans R2
    if (key && key !== 'proxy') {
      const object = await env.IMAGES_BUCKET.get(key);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        if (!headers.get('Content-Type')) {
          headers.set('Content-Type', 'image/jpeg');
        }
        return new Response(object.body, { status: 200, headers });
      }
    }

    // 2. L'image n'est pas dans R2 -> On va la chercher sur le site externe
    let remoteUrl: string | null = directUrl;

    if (!remoteUrl && key && env.DB) {
      // Clé typique: covers/alb_123.jpg ou covers/alb_123
      const idMatch = key.match(/^covers\/([^./]+)(?:\.[a-zA-Z0-9]+)?$/);
      if (idMatch) {
        const albumId = idMatch[1];
        try {
          const row = await env.DB.prepare(
            'SELECT cover_image_url FROM albums WHERE id = ? OR id = ? LIMIT 1'
          )
            .bind(albumId, `alb_${albumId}`)
            .first<{ cover_image_url: string }>();

          if (row?.cover_image_url && row.cover_image_url.startsWith('http')) {
            remoteUrl = row.cover_image_url;
          }
        } catch (dbErr) {
          console.warn('[R2 Edge] Erreur recherche D1:', dbErr);
        }
      }
    }

    // 3. Téléchargement depuis la source externe & sauvegarde immédiate dans R2
    if (remoteUrl && remoteUrl.startsWith('http')) {
      try {
        const fetchRes = await fetch(remoteUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Bullix-Cover-Sync/1.0',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          },
        });

        if (fetchRes.ok) {
          const contentType = fetchRes.headers.get('Content-Type') || 'image/jpeg';
          const buffer = await fetchRes.arrayBuffer();

          // Enregistrer dans R2
          const targetKey = (key && key !== 'proxy') ? key : `covers/${encodeURIComponent(remoteUrl.slice(-40))}.jpg`;
          await env.IMAGES_BUCKET.put(targetKey, buffer, {
            httpMetadata: {
              contentType,
            },
          });

          return new Response(buffer, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'X-Bullix-Source': 'Edge-Fetched-And-Cached-To-R2',
            },
          });
        }
      } catch (fetchErr: any) {
        console.warn('[R2 Edge] Échec du rapatriement externe:', fetchErr?.message);
      }
    }

    // 4. Si introuvable nulle part, retourner une image SVG de substitution élégante (Placeholder)
    const svgPlaceholder = `
      <svg xmlns="http://www.w3.org/2000/svg" width="160" height="220" viewBox="0 0 160 220">
        <rect width="100%" height="100%" fill="#1f2937" rx="8"/>
        <path d="M40 70h80v80H40z" fill="#374151" rx="4"/>
        <text x="80" y="115" fill="#9ca3af" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle">BULLIX</text>
        <text x="80" y="135" fill="#6b7280" font-family="sans-serif" font-size="10" text-anchor="middle">Couverture indisponible</text>
      </svg>
    `.trim();

    return new Response(svgPlaceholder, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Erreur serveur R2' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
