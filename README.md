# 📚 Bullix

> **L'assistant personnel offline-first conçu pour les collectionneurs de bandes dessinées (Franco-belge, Mangas, Comics).**

Bullix résout les problèmes quotidiens des passionnés de BD :
1. **Rangement & Localisation** : Retrouvez immédiatement n'importe quel album dans votre bibliothèque ou vos casiers physiques numérotés / étiquetés QR Code.
2. **Anti-Doublon instantané en brocante** : Fonctionnement 100 % hors-ligne sur le terrain (sans 4G ni Wi-Fi). Vérification de possession immédiate.
3. **Gestion & Complétion de séries** : Suivi des tomes manquants, des parutions et des séries en cours.

---

## ⚡ Fonctionnalités Clés

- **Modes de scan ultra-rapides** :
  - **Code-barres (EAN / UPC)** : Scan 100 % on-device via Google ML Kit Barcode Scanning.
  - **OCR de couverture** : Pour les BD anciennes sans code-barres, extraction et nettoyage automatique du titre et numéro de tome via Google ML Kit Text Recognition.
  - **Saisie assistée** : Autocomplétion locale et résolution en ligne.
- **Localisation physique** :
  - Arborescence personnalisable (*Pièce › Meuble › Étagère › Casier*).
  - Liaison avec des étiquettes QR Code physiques.
  - Modes de rangement par lots et audit d'étagères.
- **Base Online Amorcée (BDthèque & BDvore)** :
  - La recherche interroge prioritairement notre base Cloudflare D1 pré-remplie par scraping des catalogues BDthèque et BDvore.
  - Résolution instantanée sans dépendre des APIs tierces pour les BDs francophones.
- **Cache Prédictif Intelligent (« Toute la Série en Local »)** :
  - Dès qu'un tome d'une saga entre dans la collection ou est scanné, **l'intégralité des tomes de la série est téléchargée et mise en cache dans la base locale SQLite du téléphone**.
  - Zéro latence pour les scans suivants de la série et calcul des manquants 100 % hors-ligne en brocante.
- **Cascade d'APIs gratuites & ouvertes en fallback** :
  - **BnF (API SRU)** pour les éditions françaises et le dépôt légal manquant.
  - **Open Library & Google Books** pour les couvertures et compléments bibliographiques.
  - **Comic Vine / Metron** pour les comics US.
  - **MangaDex / AniList / Wikidata** pour la structure et le nombre total de tomes par série.
- **Architecture Offline-First (Héritage Needix)** :
  - Base SQLite locale (SQLDelight / Room).
  - Optimistic UI : aucune latence lors de la saisie.
  - Synchronisation asynchrone par lots avec Cloudflare D1 et résolution de conflits Last-Write-Wins (LWW).

---

## 🏗️ Architecture & Technologies

- **Frontend Multiplateforme** : Kotlin Multiplatform (KMP) & Compose Multiplatform (Android + Web Wasm, extensible iOS).
- **Scan & On-Device ML** : Google ML Kit (Barcode Scanning + Text Recognition).
- **Backend Edge Serverless** : Cloudflare Pages Functions (TypeScript).
- **Base de données distante** : Cloudflare D1 (SQLite distribué).
- **Cache & Assets** : Cloudflare KV (mise en cache des APIs externes) & Cloudflare R2 (images et couvertures).

Pour tous les détails de conception, consultez le document [ARCHITECTURE.md](ARCHITECTURE.md).
Pour le guide pas-à-pas de configuration, déploiement Cloudflare et procédure sous Windows, consultez [DEPLOYMENT_WINDOWS_CLOUDFLARE.md](DEPLOYMENT_WINDOWS_CLOUDFLARE.md).

---

## 🗄️ Structure du Projet

```
Bullix/
├── ARCHITECTURE.md     # Spécifications techniques et architecture détaillée
├── AGENTS.md           # Consignes de développement et de publication pour agents AI
├── schema.sql          # Schéma relationnel D1 & SQLite
├── wrangler.toml       # Configuration Cloudflare (Pages, D1, KV, R2)
├── shared/             # Code partagé KMP (Domaine, Données, Sync, UI Compose)
├── androidApp/         # Application Android native (CameraX, ML Kit, WorkManager)
├── wasmApp/            # Application Web Wasm (Cloudflare Pages)
├── functions/          # Cloudflare Pages Functions (API Edge Sync & Lookup)
├── scripts/
│   ├── scraping/       # Moteur de scraping BDthèque & BDvore (normalisation, CLI)
│   └── seeding/        # Génération du seed SQL batch D1 et données d'amorçage
└── .github/workflows/
    ├── scrape-and-seed.yml # CI/CD : Scraping automatisé, sauvegarde temporaire & injection D1
    └── deploy-pages.yml    # CI/CD : Déploiement Cloudflare Pages
```

---

## 🕷️ Scraping & Amorçage de la Base (BDthèque & BDvore)

Bullix dispose d'un moteur d'extraction et d'ingestion automatisé vers Cloudflare D1 :

### 1. En local (via CLI)
```bash
# Scraping rapide d'échantillon (2 séries par catégorie)
npm run scrape:quick

# Scraping complet (Franco-belge, Manga, Comics)
npm run scrape:full

# Injection du SQL généré dans Cloudflare D1
npm run d1:seed
```

### 2. Déporté sur GitHub Actions (Recommandé)
Le workflow [`.github/workflows/scrape-and-seed.yml`](.github/workflows/scrape-and-seed.yml) permet de :
1. Lancer le scraping de manière asynchrone sans surcharger la machine locale.
2. **Transfert direct des jaquettes vers Cloudflare R2** : Les jaquettes d'albums sont streamées directement vers le bucket Cloudflare R2 (`bullix-images`, juridiction UE). **Aucune image n'est stockée sur GitHub** (zéro image dans le repo ou les artefacts).
3. **Sauvegarder temporairement la base (texte uniquement)** : Publication des artefacts `scraped_data.json` et `generated_seed.sql` dans GitHub Actions (conservés 14 jours).
4. **Injecter automatiquement dans Cloudflare D1** : Exécution de `wrangler d1 execute bullix-db --remote` pour alimenter le catalogue avec les URLs d'images R2 (`/api/images/covers/:id.jpg`).
5. Planification mensuelle automatique via cron (`0 3 1 * *`) ou exécution manuelle via `workflow_dispatch`.

---

## 📄 Licence

MIT — voir le fichier [LICENSE](LICENSE).

Copyright (c) 2026 Geoff1805
