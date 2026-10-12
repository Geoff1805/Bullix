interface Env {
  CACHE_KV: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const rawIsbn = url.searchParams.get('isbn');

    if (!rawIsbn) {
      return new Response(JSON.stringify({ error: 'Paramètre isbn manquant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanIsbn = rawIsbn.replace(/[-\s]/g, '');
    const cacheKey = `isbn:${cleanIsbn}`;

    // 1. Vérification dans le Cache KV
    if (env.CACHE_KV) {
      const cached = await env.CACHE_KV.get(cacheKey, 'json');
      if (cached) {
        return new Response(JSON.stringify({ source: 'cache_kv', data: cached }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 2. Cascade 1 : BnF SRU API (France - Dépôt légal officiel)
    const bnfUrl = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=bib.isbn%20all%20%22${cleanIsbn}%22&recordSchema=dublincore&maximumRecords=1`;
    try {
      const bnfResp = await fetch(bnfUrl);
      if (bnfResp.ok) {
        const xml = await bnfResp.text();
        if (xml.includes('<dc:title>')) {
          const titleMatch = xml.match(/<dc:title>(.*?)<\/dc:title>/);
          const creatorMatch = xml.match(/<dc:creator>(.*?)<\/dc:creator>/);
          const publisherMatch = xml.match(/<dc:publisher>(.*?)<\/dc:publisher>/);
          const dateMatch = xml.match(/<dc:date>(.*?)<\/dc:date>/);

          const result = {
            isbn: cleanIsbn,
            title: titleMatch ? titleMatch[1] : null,
            authors: creatorMatch ? creatorMatch[1] : null,
            publisher: publisherMatch ? publisherMatch[1] : null,
            published_year: dateMatch ? parseInt(dateMatch[1], 10) : null,
            cover_image_url: `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-L.jpg`,
            source: 'bnf',
          };

          if (env.CACHE_KV) {
            await env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 * 30 }); // 30 jours
          }

          return new Response(JSON.stringify({ source: 'bnf', data: result }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    } catch (e) {
      // Fallback vers Open Library
    }

    // 3. Cascade 2 : Open Library API
    const openLibUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanIsbn}&format=json&jscmd=data`;
    const openLibResp = await fetch(openLibUrl);
    if (openLibResp.ok) {
      const olData: any = await openLibResp.json();
      const bookData = olData[`ISBN:${cleanIsbn}`];
      if (bookData) {
        const result = {
          isbn: cleanIsbn,
          title: bookData.title,
          authors: bookData.authors?.map((a: any) => a.name).join(', ') || null,
          publisher: bookData.publishers?.map((p: any) => p.name).join(', ') || null,
          published_year: bookData.publish_date ? parseInt(bookData.publish_date, 10) : null,
          cover_image_url: bookData.cover?.large || `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-L.jpg`,
          source: 'openlibrary',
        };

        if (env.CACHE_KV) {
          await env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 * 30 });
        }

        return new Response(JSON.stringify({ source: 'openlibrary', data: result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Album introuvable', isbn: cleanIsbn }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Erreur interne' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
