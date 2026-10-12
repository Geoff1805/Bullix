/**
 * Gestionnaire de temporisation et requêtes HTTP polies
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3,
  delayMs = 1500
): Promise<Response> {
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    ...(options.headers || {})
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { ...options, headers });
      if (response.ok || response.status === 404 || response.status === 403) {
        return response;
      }
      console.warn(`[HTTP] Tentative ${attempt}/${retries} - Erreur HTTP ${response.status} pour ${url}`);
    } catch (err: any) {
      console.warn(`[HTTP] Tentative ${attempt}/${retries} - Échec réseau pour ${url}: ${err.message}`);
    }

    if (attempt < retries) {
      await sleep(delayMs * attempt);
    }
  }

  throw new Error(`Échec après ${retries} tentatives pour l'URL: ${url}`);
}
