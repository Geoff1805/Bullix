/**
 * Fournisseurs d'APIs externes pour l'enrichissement de métadonnées Bullix.
 *
 * Pipeline en cascade ordonné :
 * 1. BnF (Bibliothèque nationale de France) — Dépôt légal officiel FR (Source n°1)
 * 2. Google Books API — Jaquettes haute définition & résumés (Complément)
 * 3. Open Library — Base internationale & jaquettes de repli (Repli)
 * 4. MangaDex — Référentiel séries mangas (Complément Manga)
 */

export interface ExternalAlbumResult {
  id: string;
  series_id: string;
  series_title: string;
  volume_number: number;
  title: string;
  isbn: string | null;
  authors: string | null;
  publisher: string | null;
  published_year: number | null;
  cover_image_url: string | null;
  description?: string | null;
  series_type: 'Franco-belge' | 'Manga' | 'Comics';
  source: 'bnf' | 'inventaire' | 'google_books' | 'openlibrary' | 'mangadex';
}

const USER_AGENT = 'Bullix-App/1.0 (https://bullix.app; contact: contact@bullix.app)';

/**
 * 1. BnF (Bibliothèque nationale de France) — API SRU Catalogue général
 * Recherche par ISBN, EAN ou recherche floue bib.fuzzyISBN
 */
export async function fetchFromBnf(isbnOrQuery: string, isIsbn: boolean): Promise<ExternalAlbumResult | null> {
  try {
    const clean = isbnOrQuery.replace(/[-\s]/g, '').trim();
    let sruQuery: string;

    if (isIsbn) {
      sruQuery = `bib.isbn all "${clean}" or bib.ean all "${clean}" or bib.fuzzyISBN all "${clean}"`;
    } else {
      sruQuery = `bib.title all "${isbnOrQuery}" or bib.author all "${isbnOrQuery}"`;
    }

    const url = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&recordSchema=dublincore&maximumRecords=1&query=${encodeURIComponent(sruQuery)}`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/xml, text/xml'
      }
    });

    if (!res.ok) return null;
    const xml = await res.text();

    if (!xml.includes('<dc:title>')) return null;

    const titleMatch = xml.match(/<dc:title>(.*?)<\/dc:title>/i);
    const creatorMatches = xml.match(/<dc:creator>(.*?)<\/dc:creator>/gi) || [];
    const publisherMatch = xml.match(/<dc:publisher>(.*?)<\/dc:publisher>/i);
    const dateMatch = xml.match(/<dc:date>(.*?)<\/dc:date>/i);
    const descMatch = xml.match(/<dc:description>(.*?)<\/dc:description>/i);
    const idMatches = xml.match(/<dc:identifier>(.*?)<\/dc:identifier>/gi) || [];

    const fullTitle = titleMatch ? cleanXmlText(titleMatch[1]) : 'Album sans titre';
    const authors = creatorMatches.map(m => cleanXmlText(m.replace(/<\/?dc:creator>/gi, ''))).join(', ') || null;
    const publisher = publisherMatch ? cleanXmlText(publisherMatch[1]) : null;
    
    let publishedYear: number | null = null;
    if (dateMatch) {
      const yearFind = dateMatch[1].match(/[0-9]{4}/);
      if (yearFind) publishedYear = parseInt(yearFind[0], 10);
    }

    // Détection de série et numéro de tome
    let seriesTitle = fullTitle;
    let albumTitle = fullTitle;
    let volumeNumber = 1;

    // Motifs courants dans les notices BnF : "Astérix. 1, Astérix le Gaulois" ou "Tome 1 -"
    const volMatch = fullTitle.match(/(.*?)\.\s*([0-9]+)[,\s:-]+(.*)/i) || fullTitle.match(/(.*?)\s*[-:]\s*Tome\s*([0-9]+)\s*[-:]\s*(.*)/i);
    if (volMatch) {
      seriesTitle = volMatch[1].trim();
      volumeNumber = parseInt(volMatch[2], 10) || 1;
      albumTitle = volMatch[3].trim() || `Tome ${volumeNumber}`;
    }

    // Détection du type (Manga, Comics, Franco-belge)
    let seriesType: 'Franco-belge' | 'Manga' | 'Comics' = 'Franco-belge';
    if (/manga/i.test(xml) || /japon/i.test(xml)) seriesType = 'Manga';
    else if (/comics/i.test(xml) || /marvel|dc comics/i.test(xml)) seriesType = 'Comics';

    // Recherche jaquette BnF Gallica ou repli Open Library
    let coverUrl: string | null = null;
    for (const idStr of idMatches) {
      if (idStr.includes('ark:/12148/')) {
        const arkMatch = idStr.match(/ark:\/12148\/[a-z0-9]+/i);
        if (arkMatch) {
          coverUrl = `https://gallica.bnf.fr/${arkMatch[0]}/thumbnail`;
          break;
        }
      }
    }

    if (!coverUrl && isIsbn) {
      coverUrl = `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`;
    }

    return {
      id: `alb_bnf_${clean}`,
      series_id: `s_${cleanSlug(seriesTitle)}`,
      series_title: seriesTitle,
      volume_number: volumeNumber,
      title: albumTitle,
      isbn: isIsbn ? clean : null,
      authors: authors,
      publisher: publisher,
      published_year: publishedYear,
      cover_image_url: coverUrl,
      description: descMatch ? cleanXmlText(descMatch[1]) : null,
      series_type: seriesType,
      source: 'bnf'
    };
  } catch (err) {
    console.warn('[BnF API] Erreur:', err);
    return null;
  }
}

/**
 * 2. Google Books API — Jaquettes & résumés
 */
export async function fetchFromGoogleBooks(isbnOrQuery: string, isIsbn: boolean): Promise<ExternalAlbumResult | null> {
  try {
    const clean = isbnOrQuery.replace(/[-\s]/g, '').trim();
    const qParam = isIsbn ? `isbn:${clean}` : encodeURIComponent(isbnOrQuery);
    const url = `https://www.googleapis.com/books/v1/volumes?q=${qParam}&maxResults=1&langRestrict=fr`;

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT }
    });

    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data.items || data.items.length === 0) return null;

    const book = data.items[0].volumeInfo;
    const fullTitle = book.title || 'Album sans titre';
    const authors = book.authors ? book.authors.join(', ') : null;
    const publisher = book.publisher || null;
    const desc = book.description || null;

    let publishedYear: number | null = null;
    if (book.publishedDate) {
      const yr = book.publishedDate.match(/[0-9]{4}/);
      if (yr) publishedYear = parseInt(yr[0], 10);
    }

    // Couverture Google Books (optimisée en HTTPS sans curl proxy)
    let coverUrl: string | null = null;
    if (book.imageLinks) {
      const rawImg = book.imageLinks.extraLarge || book.imageLinks.large || book.imageLinks.medium || book.imageLinks.thumbnail || book.imageLinks.smallThumbnail;
      if (rawImg) {
        coverUrl = rawImg.replace(/^http:\/\//i, 'https://');
      }
    }

    let seriesTitle = book.subtitle ? fullTitle : fullTitle;
    let albumTitle = book.subtitle || fullTitle;
    let volumeNumber = 1;

    const volMatch = fullTitle.match(/(.*?)\s*[-:]\s*(?:Tome|Vol|Volume|\#)\s*([0-9]+)\s*[-:]?\s*(.*)/i);
    if (volMatch) {
      seriesTitle = volMatch[1].trim();
      volumeNumber = parseInt(volMatch[2], 10) || 1;
      if (volMatch[3]?.trim()) albumTitle = volMatch[3].trim();
    }

    let seriesType: 'Franco-belge' | 'Manga' | 'Comics' = 'Franco-belge';
    const cats = (book.categories || []).join(' ').toLowerCase();
    if (cats.includes('manga') || /manga/i.test(fullTitle)) seriesType = 'Manga';
    else if (cats.includes('comics') || /comics|superhero/i.test(fullTitle)) seriesType = 'Comics';

    return {
      id: `alb_gb_${data.items[0].id}`,
      series_id: `s_${cleanSlug(seriesTitle)}`,
      series_title: seriesTitle,
      volume_number: volumeNumber,
      title: albumTitle,
      isbn: isIsbn ? clean : null,
      authors: authors,
      publisher: publisher,
      published_year: publishedYear,
      cover_image_url: coverUrl,
      description: desc,
      series_type: seriesType,
      source: 'google_books'
    };
  } catch (err) {
    console.warn('[Google Books API] Erreur:', err);
    return null;
  }
}

/**
 * 3. Open Library API — Base ouverte de repli
 */
export async function fetchFromOpenLibrary(isbnOrQuery: string, isIsbn: boolean): Promise<ExternalAlbumResult | null> {
  try {
    const clean = isbnOrQuery.replace(/[-\s]/g, '').trim();
    if (isIsbn) {
      const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${clean}&format=json&jscmd=data`;
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) return null;
      const data: any = await res.json();
      const book = data[`ISBN:${clean}`];
      if (!book) return null;

      const authors = book.authors ? book.authors.map((a: any) => a.name).join(', ') : null;
      const publisher = book.publishers ? book.publishers.map((p: any) => p.name).join(', ') : null;

      let publishedYear: number | null = null;
      if (book.publish_date) {
        const y = book.publish_date.match(/[0-9]{4}/);
        if (y) publishedYear = parseInt(y[0], 10);
      }

      const coverUrl = book.cover?.large || book.cover?.medium || `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`;

      return {
        id: `alb_ol_${clean}`,
        series_id: `s_${cleanSlug(book.title || 'Sans titre')}`,
        series_title: book.title || 'Sans titre',
        volume_number: 1,
        title: book.title || 'Sans titre',
        isbn: clean,
        authors: authors,
        publisher: publisher,
        published_year: publishedYear,
        cover_image_url: coverUrl,
        series_type: 'Franco-belge',
        source: 'openlibrary'
      };
    } else {
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(isbnOrQuery)}&limit=1`;
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) return null;
      const data: any = await res.json();
      if (!data.docs || data.docs.length === 0) return null;
      const doc = data.docs[0];

      return {
        id: `alb_ol_${doc.key.replace(/\//g, '_')}`,
        series_id: `s_${cleanSlug(doc.title)}`,
        series_title: doc.title,
        volume_number: 1,
        title: doc.title,
        isbn: doc.isbn ? doc.isbn[0] : null,
        authors: doc.author_name ? doc.author_name.join(', ') : null,
        publisher: doc.publisher ? doc.publisher[0] : null,
        published_year: doc.first_publish_year || null,
        cover_image_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
        series_type: 'Franco-belge',
        source: 'openlibrary'
      };
    }
  } catch (err) {
    console.warn('[Open Library API] Erreur:', err);
    return null;
  }
}

/**
 * 4. MangaDex API — Dédiée aux Séries Mangas
 */
export async function fetchFromMangaDex(query: string): Promise<ExternalAlbumResult | null> {
  try {
    const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=1&includes[]=cover_art`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data.data || data.data.length === 0) return null;

    const manga = data.data[0];
    const attrs = manga.attributes;
    const title = attrs.title.fr || attrs.title.en || Object.values(attrs.title)[0] || query;
    const desc = attrs.description?.fr || attrs.description?.en || null;
    const year = attrs.year || null;

    let coverUrl: string | null = null;
    const coverRel = manga.relationships?.find((r: any) => r.type === 'cover_art');
    if (coverRel && coverRel.attributes?.fileName) {
      coverUrl = `https://uploads.mangadex.org/covers/${manga.id}/${coverRel.attributes.fileName}.512.jpg`;
    }

    return {
      id: `alb_md_${manga.id}_01`,
      series_id: `s_md_${manga.id}`,
      series_title: title,
      volume_number: 1,
      title: `${title} - Tome 1`,
      isbn: null,
      authors: null,
      publisher: null,
      published_year: year,
      cover_image_url: coverUrl,
      description: desc,
      series_type: 'Manga',
      source: 'mangadex'
    };
  } catch (err) {
    console.warn('[MangaDex API] Erreur:', err);
    return null;
  }
}
/**
 * 5. Inventaire.io — Base ouverte & collaborative (Équivalent Open Food Facts du livre)
 * Données ouvertes reliées à Wikidata et à la BnF avec jaquettes
 */
export async function fetchFromInventaire(isbn: string): Promise<ExternalAlbumResult | null> {
  try {
    const clean = isbn.replace(/[-\s]/g, '').trim();
    const url = `https://inventaire.io/entity/isbn:${clean}.json`;

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data.entities) return null;

    const entityKeys = Object.keys(data.entities);
    if (entityKeys.length === 0) return null;

    const entity = data.entities[entityKeys[0]];
    const title = entity.labels?.fromclaims || entity.claims?.['wdt:P1476'] || 'Album sans titre';
    const pubDate = entity.claims?.['wdt:P577'];
    let publishedYear: number | null = null;
    if (pubDate) {
      const y = String(pubDate).match(/[0-9]{4}/);
      if (y) publishedYear = parseInt(y[0], 10);
    }

    let coverUrl: string | null = null;
    if (entity.image?.url) {
      coverUrl = `https://inventaire.io${entity.image.url}`;
    } else {
      coverUrl = `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`;
    }

    return {
      id: `alb_inv_${clean}`,
      series_id: `s_${cleanSlug(title)}`,
      series_title: title,
      volume_number: 1,
      title: title,
      isbn: clean,
      authors: null,
      publisher: null,
      published_year: publishedYear,
      cover_image_url: coverUrl,
      series_type: 'Franco-belge',
      source: 'inventaire'
    };
  } catch (err) {
    console.warn('[Inventaire API] Erreur:', err);
    return null;
  }
}

/**
 * Orchestrateur de recherche en cascade (Waterfall Pipeline)
 * Priorité : 1. BnF -> 2. Inventaire.io -> 3. Google Books -> 4. Open Library -> 5. MangaDex
 */
export async function cascadeLookup(isbnOrQuery: string, isIsbn: boolean): Promise<ExternalAlbumResult | null> {
  // 1. Source n°1 : BnF Catalogue général
  const bnfResult = await fetchFromBnf(isbnOrQuery, isIsbn);
  if (bnfResult) return bnfResult;

  // 2. Source collaborative ouverte : Inventaire.io (si ISBN)
  if (isIsbn) {
    const invResult = await fetchFromInventaire(isbnOrQuery);
    if (invResult) return invResult;
  }

  // 3. Source complémentaire : Google Books
  const gbResult = await fetchFromGoogleBooks(isbnOrQuery, isIsbn);
  if (gbResult) return gbResult;

  // 4. Source de repli : Open Library
  const olResult = await fetchFromOpenLibrary(isbnOrQuery, isIsbn);
  if (olResult) return olResult;

  // 5. Source manga spécifique si recherche textuelle
  if (!isIsbn) {
    const mdResult = await fetchFromMangaDex(isbnOrQuery);
    if (mdResult) return mdResult;
  }

  return null;
}

function cleanXmlText(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

