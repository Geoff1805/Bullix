# Architecture & Proposition Technique — Projet Bullix

Ce document détaille la proposition technique, les choix d'architecture logicielle, les flux de données et la stratégie d'implémentation pour l'application **Bullix**, conçue pour les collectionneurs de bandes dessinées (Franco-belge, Mangas, Comics).

---

## 1. Vision & Objectifs Métier

Bullix résout les trois frustrations majeures rencontrées sur le terrain par les collectionneurs :

1. **Rangement & Localisation physique ultra-précise** :
   - Arborescence visuelle : *Salon › Bibliothèque Est › Étagère 2 › Casier 12*.
   - Identification physique des casiers par **QR Codes** scannables.
   - Modes rapides : Saisie par lot ("Range-tout") et mode "Audit / Inventaire d'étagère".
2. **Anti-Doublon instantané en brocante / convention ("Offline-First")** :
   - 100 % opérationnel sans 4G/5G ni Wi-Fi (caves, hangars, vide-greniers reculés).
   - Réponse en moins de 100 ms : « Album déjà possédé ? Oui/Non », avec état d'usure et casier associé.
3. **Complétion intelligente des séries** :
   - Détection automatique du statut de la série (en cours, terminée, abandonnée).
   - Tableau de bord des tomes manquants (« *Voir les suites* »).

---

## 2. Architecture Globale du Système

Bullix capitalise sur le socle éprouvé du projet **Needix** (Kotlin Multiplatform + Cloudflare Edge Serverless).

```mermaid
flowchart TB
    subgraph Client ["Client Multiplateforme (KMP / Compose)"]
        UI["Compose Multiplatform UI\n(Android / Web Wasm)"]
        Scanner["Camera & ML Kit\n(Barcode EAN/UPC + OCR Couverture)"]
        LocalDB[("Base Locale SQLite\n(SQLDelight / Room)")]
        SyncWorker["Moteur de Sync Offline-First\n(WorkManager / Web Worker)"]
        
        UI <--> LocalDB
        Scanner --> UI
        LocalDB <--> SyncWorker
    end

    subgraph Edge ["Cloudflare Serverless Edge"]
        Pages["Cloudflare Pages Functions\n(/api/sync, /api/lookup)"]
        D1[("Cloudflare D1\n(SQLite distribué Edge)")]
        KV[("Cloudflare KV\n(Cache API externes)")]
        R2[("Cloudflare R2\n(Stockage Couvertures / Photos)")]

        Pages <--> D1
        Pages <--> KV
        Pages <--> R2
    end

    subgraph Providers ["Cascade d'APIs Publiques (Gratuites)"]
        BnF["BnF SRU API\n(BD & Manga FR)"]
        OpenLib["Open Library / Google Books\n(Covers & Fallback)"]
        ComicsAPI["Comic Vine / Metron\n(Comics US & UPC)"]
        MangaAPI["MangaDex / AniList / Wikidata\n(Structure & Nbr Tomes)"]

        Pages --> BnF
        Pages --> OpenLib
        Pages --> ComicsAPI
        Pages --> MangaAPI
    end

    SyncWorker -- "Batch Push / Pull (JSON, LWW)" --> Pages
```

---

---

## 3. Stratégie de Capture, Recherche & Cache Prédictif

L'identification suit une hiérarchie stricte en 3 niveaux, optimisée pour minimiser les appels externes et maximiser l'autonomie hors-ligne.

```mermaid
flowchart TD
    Scan["Scan Code-barres ou OCR Couverture"] --> Step0{"1. Base Locale SQLite\n(Sur l'appareil)"}
    Step0 -- "Trouvé (< 50ms)" --> FoundLocal["Affichage Statut\n(Déjà possédé ? Casier ?)"]
    Step0 -- "Non trouvé localement" --> Step1{"2. Base Online Bullix D1\n(Scraping BDthèque + BDvore)"}
    
    Step1 -- "Trouvé dans notre D1" --> CacheSeries["🔥 Mise en cache locale\nde TOUTE LA SÉRIE"]
    CacheSeries --> FoundD1["Affichage Fiche & Ajout"]
    
    Step1 -- "Absent de notre base" --> Step2{"3. Cascade APIs Externes\n(BnF, OpenLib, MangaDex)"}
    Step2 -- "Résolu" --> SaveOnline["Enregistrement dans D1\n+ Cache série complète local"]
    Step2 -- "Échec" --> Manual["Saisie Manuelle Assistée"]
```

### 3.1. Hiérarchie de Résolution des Requêtes

1. **Niveau 0 — Base Locale Smartphone (0 latence, 100 % Offline)** :
   - Vérification instantanée par ISBN ou identifiant dans SQLite local.
2. **Niveau 1 — Base Online Bullix / Cloudflare D1 (Priorité Première en Ligne)** :
   - Notre base D1 est pré-alimentée en amont par un **scraping d'amorçage massif** de la **BDthèque** et de **BDvore**.
   - Si la connexion est active et que l'album n'est pas encore en local, la recherche interroge directement notre D1 Edge (`/api/lookup/isbn`).
   - Couvre la quasi-totalité du patrimoine Franco-belge, mangas et comics traduits.
3. **Niveau 2 — Cascade d'APIs Publiques de Secours (Fallback)** :
   - Uniquement si l'album n'est pas encore répertorié dans notre base D1 :
     - **BnF (API SRU)** : Référence légale officielle ISBN/EAN français.
     - **Open Library & Google Books** : Récupération des jaquettes manquantes et éditions internationales.
     - **Comic Vine / Metron** : Fascicules et codes UPC US.
     - **MangaDex / AniList / Wikidata** : Séries japonaises et nombre total de tomes.
   - Dès qu'un album est résolu par la cascade externe, il est automatiquement enregistré dans notre base D1 pour enrichir définitivement le catalogue commun.

---

### 3.2. Stratégie de Cache Prédictif : « Toute la Série en Local »

> **Règle fondamentale** : Dès qu'un utilisateur possède, scanne ou consulte un tome d'une série, **l'intégralité de la série et de tous ses tomes existants est immédiatement téléchargée et mise en cache dans la base SQLite locale du smartphone.**

#### Pourquoi cette approche est décisive sur le terrain :
- **Autonomie totale en brocante** : Si l'utilisateur possède déjà le Tome 1 de *Tintin* ou d'*Astérix*, les tomes 2 à 40 sont déjà stockés dans son téléphone. En plein hangar sans aucun réseau, scanner le Tome 7 indiquera instantanément s'il est manquant ou possédé.
- **« Voir les suites » instantané** : La liste des tomes manquants est calculée localement sans aucun appel réseau.
- **Économie de bande passante** : Un seul appel groupé (`GET /api/series/cache?series_id=...`) rapatrie en une fraction de seconde la totalité des tomes de la saga, éliminant tout appel ultérieur.

---

### 3.3. Amorçage de la Base Online (Scraping BDthèque & BDvore)

Afin de disposer immédiatement d'un référentiel francophone ultra-complet sans dépendre des temps de réponse d'API tierces :

1. **Extraction Initiale One-Off** :
   - Script de scraping batch ciblant les séries et albums majeurs sur **BDthèque** et **BDvore** (respect des quotas et temporisation pour éviter tout blocage).
   - Récupération des métadonnées clés : Titre de série, numéro de tome, titre de l'album, EAN/ISBN, éditeur, année de parution, lien de couverture, nombre total de tomes parus, statut ("En cours" / "Terminée").
2. **Normalisation & Dédoublonnage** :
   - Nettoyage des ISBN (format EAN-13 sans tirets).
   - Alignement des numéros de tomes au format numérique (gestion des hors-séries et intégrales).
   - Dédoublonnage des séries communes entre BDthèque et BDvore.
3. **Ingestion dans Cloudflare D1** :
   - Injection par batch SQL dans les tables `series` et `albums` via Cloudflare Wrangler CLI (`wrangler d1 execute bullix-db --file=seed.sql`) ou via Cloudflare R2 staging dump.

---

## 4. Modèle de Données Relationnel (Cloudflare D1 & SQLite)

Le schéma dissocie le **catalogue universel** (référentiel des séries et albums) des **données physiques de l'utilisateur** (emplacements, possession, état), tout en intégrant la table de journalisation de synchronisation.

```sql
-- ============================================================================
-- 1. SÉRIES & ALBUMS (Référentiel Universel)
-- ============================================================================

CREATE TABLE IF NOT EXISTS series (
    id TEXT PRIMARY KEY NOT NULL,          -- UUIDv4 ou slug universel
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('Franco-belge', 'Manga', 'Comics', 'Autre')),
    status TEXT CHECK(status IN ('En cours', 'Terminée', 'Abandonnée', 'Inconnue')),
    total_volumes INTEGER DEFAULT NULL,
    publisher_default TEXT,
    created_at INTEGER NOT NULL,           -- Timestamp Unix (ms)
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_series_title ON series(title);

CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY NOT NULL,          -- UUIDv4
    series_id TEXT NOT NULL,
    volume_number REAL NOT NULL,           -- Supporte les tomes spéciaux (ex: 0, 1.5)
    title TEXT,
    isbn TEXT,                             -- EAN-13 / ISBN-10 (Indexé)
    upc TEXT,                              -- UPC Comics US
    authors TEXT,                          -- Format JSON ou CSV dénormalisé
    publisher TEXT,
    published_year INTEGER,
    cover_image_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL,
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_albums_isbn ON albums(isbn);
CREATE INDEX IF NOT EXISTS idx_albums_series_id ON albums(series_id, volume_number);

-- ============================================================================
-- 2. LOCALISATIONS & COLLECTION UTILISATEUR
-- ============================================================================

CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,                    -- Ex: "Salon › Bibliothèque Est › Casier 12"
    qr_code_ref TEXT UNIQUE,              -- Valeur encodée dans le QR physique
    color_tag TEXT,                        -- Repère visuel dans l'interface
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_locations_user ON locations(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_qr ON locations(qr_code_ref);

CREATE TABLE IF NOT EXISTS user_collection (
    id TEXT PRIMARY KEY NOT NULL,          -- UUIDv4
    user_id TEXT NOT NULL,
    album_id TEXT NOT NULL,
    location_id TEXT,                      -- NULL = en attente de rangement
    condition TEXT CHECK(condition IN ('Neuf', 'Très bon', 'Bon', 'Passable', 'Mauvais', 'Lu')),
    edition_info TEXT,                     -- Ex: "Édition originale", "Tirage limité n°42"
    purchase_price REAL,
    purchase_date TEXT,
    notes TEXT,
    is_favorite INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL,
    FOREIGN KEY (album_id) REFERENCES albums(id),
    FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS idx_user_collection_user ON user_collection(user_id);
CREATE INDEX IF NOT EXISTS idx_user_collection_album ON user_collection(album_id);
CREATE INDEX IF NOT EXISTS idx_user_collection_location ON user_collection(location_id);

-- ============================================================================
-- 3. JOURNAL DE SYNCHRONISATION (Generic Sync Records)
-- ============================================================================

CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY NOT NULL,          -- UUIDv4 généré côté client
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,             -- 'series', 'album', 'location', 'user_collection'
    payload TEXT NOT NULL,                 -- JSON complet de l'entité
    sync_status TEXT DEFAULT 'SYNCED',     -- 'SYNCED', 'PENDING_INSERT', 'PENDING_UPDATE', 'PENDING_DELETE'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,           -- Timestamp Unix (ms)
    deleted_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_updated_at ON records(updated_at);
CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
CREATE INDEX IF NOT EXISTS idx_records_entity ON records(entity_type, user_id);
```

---

## 5. Mécanique de Synchronisation Offline-First

### 5.1. Principe d'Écriture Locale Prioritaire (Optimistic UI)
1. Toute modification utilisateur (ajout, déplacement de casier, notation d'état) est enregistrée **immédiatement dans la base SQLite locale**.
2. L'interface Compose réagit instantanément sans blocage réseau.
3. Le champ `sync_status` local prend la valeur `PENDING_INSERT`, `PENDING_UPDATE` ou `PENDING_DELETE`, et `updated_at` reçoit l'horodatage courant `System.currentTimeMillis()`.

### 5.2. Cycle de Push (Envoi en Lot)
- **Déclenchement** : Automatique lors de la reconnexion réseau (via `WorkManager` sous Android ou `navigator.onLine` sous Wasm Web), ou déclenchement manuel lors du pull-to-refresh.
- **Payload** : Envoi d'un lot (`batch`) de mutations au format JSON vers `POST /api/sync/push`.
- **Résolution de conflits côté Edge (Last-Write-Wins)** :
  - L'API Cloudflare compare le `updated_at` entrant avec le `updated_at` présent dans D1.
  - L'enregistrement le plus récent l'emporte.
- **Accusé de réception (ACK)** : L'API renvoie la liste des identifiants confirmés ; le worker local met à jour leur statut en `SYNCED`.

### 5.3. Cycle de Pull (Récupération des Deltas)
- Le client appelle `GET /api/sync/pull?since={last_sync_timestamp}`.
- Cloudflare D1 extrait les enregistrements modifiés ou supprimés (`deleted_at IS NOT NULL`) depuis cet horodatage.
- Le client met à jour sa base locale et avance son curseur `last_sync_timestamp`.

---

## 6. Stack Technique & Découpage Modulaire

```
Bullix/
├── shared/                         # Logique commune KMP
│   ├── commonMain/
│   │   ├── kotlin/fr/bullix/
│   │   │   ├── domain/             # Modèles métier & UseCases
│   │   │   ├── data/               # Repositories, SQLDelight DB
│   │   │   ├── sync/               # SyncEngine, DeltaTracker, LWW
│   │   │   ├── api/                # Clients BnF, OpenLib, Cloudflare API
│   │   │   └── ui/                 # Composants d'interface Compose Multiplatform
│   │   └── sqldelight/             # Définitions de tables et requêtes SQLDelight
│   ├── androidMain/                # Implémentations CameraX, ML Kit Barcode & OCR
│   └── wasmJsMain/                 # Implémentations Web BarcodeDetector, Storage
├── androidApp/                     # Application Android native (Hilt/Koin, WorkManager)
├── wasmApp/                        # Application Web Wasm déployée sur Cloudflare Pages
├── functions/                      # Cloudflare Pages Functions (Edge API TypeScript)
│   ├── api/
│   │   ├── sync/
│   │   │   ├── push.ts             # Traitement batch & LWW D1
│   │   │   └── pull.ts             # Récupération delta D1
│   │   ├── series/
│   │   │   └── cache.ts            # Téléchargement et cache d'une série complète
│   │   └── lookup/
│   │       ├── isbn.ts             # Résolution EAN (D1 prioritaire, cache KV, BnF)
│   │       └── ocr.ts              # Recherche textuelle intelligente
├── scripts/
│   └── seeding/
│       ├── import_seed.ts          # Script d'import et batching BDthèque/BDvore
│       └── schema_seed.sql         # Jeu de données d'amorçage
├── wrangler.toml                   # Configuration Cloudflare (D1, KV, R2)
└── schema.sql                      # Schéma SQL initial pour D1
```

---

## 7. Plan de Déploiement & Roadmap

1. **Jalon 1 — Socle Core & Local-First (Semaine 1-2)**
   - Initialisation du projet KMP (Compose Multiplatform Android + Web Wasm).
   - Schéma SQLDelight local et tables métier (`series`, `albums`, `locations`, `user_collection`).
   - Écran de collection, navigation par casiers et fiche album.
2. **Jalon 2 — Moteur de Scan & Cascade d'APIs (Semaine 3-4)**
   - Intégration ML Kit Barcode Scanning (EAN-13).
   - Intégration ML Kit Text Recognition pour l'OCR de couverture avec algorithme de nettoyage de titre.
   - Module Cloudflare Pages Functions pour la résolution BnF + Open Library avec mise en cache Cloudflare KV.
3. **Jalon 3 — Synchronisation Cloudflare D1 & Mode Web (Semaine 5-6)**
   - Mise en place du `SyncEngine` bidirectionnel avec `WorkManager`.
   - Endpoints `/api/sync/push` et `/api/sync/pull` sur Cloudflare Pages.
   - Build et déploiement continu du client Web Wasm sur Cloudflare Pages.
4. **Jalon 4 — QR Codes & Complétion des Séries (Semaine 7)**
   - Génération et impression d'étiquettes QR Code pour les casiers.
   - Algorithme de détection des tomes manquants (« *Voir les suites* »).
