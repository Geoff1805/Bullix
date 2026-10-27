# Spécifications Fonctionnelles & Techniques Détaillées — Bullix

> **Application** : Bullix — Assistant Offline-First pour Collectionneurs de Bandes Dessinées  
> **Package ID** : `fr.bullix.app` | **Dépôt** : `Geoff1805/Bullix`  
> **Emplacement local** : `G:\Mon Drive\05_Dev\Bullix`  
> **Statut** : Spécification détaillée — Document de référence éditable

---

## 1. Diagnostic de Stack : Allègement & Harmonisation

### 1.1. État Actuel vs Stack Cible Épurée (Zéro Surcouche)
Actuellement, Bullix combine KMP, Compose Multiplatform, Cloudflare Workers, ML Kit et Room KMP. Pour éviter l'inflation de dépendances ("trop de stack") :

| Composant | Solution Actuelle | Cible Consolidée & Allégée | Justification Économie & Simplicité |
| :--- | :--- | :--- | :--- |
| **Framework UI** | Compose Multiplatform 1.7 | Compose Material 3 déclaratif | Zéro widget tiers lourd, composants M3 natifs |
| **Base Locale** | Room KMP SQLite | Room KMP (`androidx.room`) | Source unique de vérité, persistance locale 100% offline |
| **Réseau HTTP** | Ktor Client 3.x | Ktor Client Core + CIO / OkHttp engine | Moteur KMP unifié, suppression de Retrofit/OkHttp brut |
| **Sérialisation** | `kotlinx.serialization` | `kotlinx.serialization.json` | 0 token, génération de code KSP sans réflexion |
| **Vision & Scan** | ML Kit Barcode + Text OCR | ML Kit on-device pur | Zéro appel cloud, exécution locale en < 150 ms |
| **Backend Sync** | Cloudflare Pages + D1 | Cloudflare Worker + D1 SQL | Serverless gratuit, zéro VM ou serveur payant |

---

## 2. Architecture Logicielle & Patterns (MVI / Clean Architecture)

```mermaid
flowchart TD
    UI[Compose Screens & Components] -->|UiEvent| VM[ViewModel]
    VM -->|UiState (StateFlow)| UI
    VM -->|Appel suspend| Repo[CollectionRepository & SeriesCacheManager]
    Repo -->|Requêtes SQL| DAO[BullixDatabase - Room KMP]
    Repo -->|Cascade fallback si réseau| Net[Ktor Client -> D1 / APIs Publiques]
    Net -.->|Mise en cache locale automatique| DAO
```

### 2.1. Pattern d'État UI Standard
```kotlin
sealed interface CollectionUiState {
    data object Loading : CollectionUiState
    data class Success(
        val totalAlbums: Int,
        val totalSeries: Int,
        val seriesWithMissingCount: Int,
        val seriesList: List<SeriesWithAlbumsVo>,
        val currentFilter: CollectionFilter
    ) : CollectionUiState
    data class Empty(val reason: EmptyReason) : CollectionUiState
    data class Error(val message: String, val canRetry: Boolean) : CollectionUiState
}
```

---

## 3. Spécifications Détaillées des Écrans (UI/UX)

### Écran 1 : `CollectionScreen` (Bibliothèque & Séries)
- **TopAppBar** :
  - Titre dynamique avec compteur (ex: *Ma Bédéthèque (248 albums)*).
  - Icône Recherche (ouvre une `SearchBar` animée avec historique de recherche).
  - Icône Filtres & Tri (`DropdownMenu` : Par Titre, Par Série, Par Date d'ajout, Par Auteur, Par Complétion).
  - Icône Vue Grille / Vue Liste (bascule d'affichage persistée en `DataStore`).
- **Corps de page** :
  - **Onglets principaux (TabRow)** :
    1. *Toutes les Séries* (cartes dépliables affichant la jauge de progression : ex. `14/15 tomes - Manque le T12`).
    2. *Albums Isolés / One-Shots*.
    3. *Tomes Manquants (Wishlist automatique)* : Liste triée par série pour les achats en brocante.
    4. *Prêts en cours* : Badges orange avec nom de l'emprunteur et jours écoulés.
- **Floating Action Button (FAB)** :
  - Bouton extensible : Scan Caméra rapide (Barcode ou OCR) ou Ajout Manuel.

> ✍️ **[À COMPLÉTER PAR L'UTILISATEUR — Écran Collection]** :
> - *Comportement au clic sur un tome manquant (marquer acheté, chercher sur le web, ajouter note de prix) :*
> - *Informations visuelles prioritaires sur la carte de série (année, éditeur, statut terminée/en cours) :*

---

### Écran 2 : `ScannerScreen` (Viseur Caméra Haute Vitesse)
- **Interface Caméra (CameraX)** :
  - Viseur central avec cadre de cadrage dynamique (rectangle horizontal pour code-barres EAN13, cadre page entière pour couverture OCR).
  - Bouton basculeur à 2 positions en haut : `[Code-barres (EAN)]` / `[Couverture OCR]`.
  - Bouton Torche / Flash (Allumé / Éteint).
- **Cinématique Anti-Doublon Immédiate (< 200 ms)** :
  - **Cas 1 : Album DÉJÀ POSSÉDÉ** ➔ Vibreur 2 impulsions courtes, bandeau ROUGE clignotant : `⚠️ DÉJÀ POSSÉDÉ ! (Tome X rangé dans Salon > Étagère 2 > Casier B)`.
  - **Cas 2 : Tome MANQUANT d'une série connue** ➔ Vibreur 1 impulsion longue, bandeau VERT vif : `✅ TOME MANQUANT ! Série "Blacksad" (Vous possédez déjà les T1, T2, T3)`. Bouton 1-Tap "Ajouter à ma collection".
  - **Cas 3 : Album INCONNU** ➔ Résolution en cache local ou requête D1 en tâche de fond, fiche de prévisualisation bottom-sheet.

> ✍️ **[À COMPLÉTER PAR L'UTILISATEUR — Écran Scanner]** :
> - *Mode "Scan continu en rafale" (bip à la chaîne en vide-grenier sans fermer la caméra) :*
> - *Action par défaut si l'album n'a ni code-barres ni texte lisible :*

---

### Écran 3 : `SeriesDetailScreen` (Détail Série & Complétion)
- **En-tête Série** : Bannière avec visuel grand format, Titre, Scénariste, Dessinateur, Éditeur, Statut (*Série terminée* / *En cours*), Jauge de complétion (ex: 85%).
- **Frise Numérique des Tomes** :
  - Grille horizontale ou matrice des numéros : `[1] [2] [3] [4] [5 (manquant)] [6] ...`.
  - Pastille verte = Possédé (clic ouvre la fiche album).
  - Pastille grise en pointillés = Manquant (clic permet d'indiquer "Recherché activement" ou "Ignorer ce tome").
- **Section Rangement** : Lieux physiques associés aux tomes de cette série.

---

### Écran 4 : `LocationsScreen` (Rangement Physique & QR Codes)
- **Arborescence Réelle** :
  - Niveau 1 : Pièce (ex: *Bureau*, *Salon*, *Chambre*).
  - Niveau 2 : Meuble (ex: *Bibliothèque Billy*, *Meuble métallique*).
  - Niveau 3 : Étagère (ex: *Étagère 1 (Haut)*, *Étagère 2*).
  - Niveau 4 : Casier / Bac (ex: *Casier BD Franco-Belge A-D*).
- **Fonctionnalité QR Code** :
  - Impression / export d'étiquettes QR Code pour chaque casier ou étagère.
  - Scan du QR Code physique du meuble pour afficher instantanément la liste des BD qui doivent s'y trouver.

> ✍️ **[À COMPLÉTER PAR L'UTILISATEUR — Rangement]** :
> - *Alerte de dépassement si plus de X BD par casier :*
> - *Ordre de classement physique par défaut (alphabétique série, par auteur, par taille format) :*

---

## 4. Modèle de Données Exhaustif (Room KMP SQLite)

### 4.1. Table `series`
```sql
CREATE TABLE IF NOT EXISTS series (
    id TEXT PRIMARY KEY NOT NULL,             -- UUID ou slug normalisé (ex: "blacksad")
    title TEXT NOT NULL,                     -- Titre de la série
    author_writer TEXT,                      -- Scénariste
    author_cartoonist TEXT,                  -- Dessinateur
    publisher TEXT,                          -- Éditeur (ex: Dargaud)
    genre TEXT,                              -- Franco-Belge, Manga, Comics, Roman Graphique
    total_tomes_known INTEGER DEFAULT 0,     -- Nombre total de tomes parus
    is_finished INTEGER NOT NULL DEFAULT 0,  -- 0 = en cours, 1 = terminée
    cached_at INTEGER NOT NULL,              -- Timestamp epoch de mise en cache
    sync_status TEXT DEFAULT 'SYNCED'        -- SYNCED, PENDING_UPLOAD
);
CREATE INDEX IF NOT EXISTS idx_series_title ON series(title);
```

### 4.2. Table `albums`
```sql
CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY NOT NULL,             -- UUID
    series_id TEXT NOT NULL,                  -- Clé étrangère vers series(id)
    tome_number INTEGER NOT NULL,            -- Numéro du tome (ex: 5)
    tome_sub_number TEXT,                    -- Sous-numéro si hors-série (ex: "HS1", "0")
    title TEXT NOT NULL,                     -- Titre de l'album
    isbn TEXT,                               -- EAN13 / ISBN normalisé 13 chiffres
    publication_year INTEGER,                -- Année d'édition
    edition_type TEXT DEFAULT 'NORMAL',      -- NORMAL, EO (Édition Originale), TIRAGE_TETE, INTEGRALE
    purchase_date INTEGER,                   -- Timestamp date d'achat
    purchase_price REAL,                     -- Prix payé
    estimated_value REAL,                    -- Cote ou valeur estimée
    condition_grade TEXT DEFAULT 'VERY_GOOD',-- MINT, NEAR_MINT, VERY_GOOD, GOOD, POOR
    cover_image_path TEXT,                   -- Chemin local vers l'image en cache
    location_id TEXT,                        -- Clé étrangère vers locations(id)
    is_signed INTEGER DEFAULT 0,             -- 1 si dédicacé
    loan_to_person TEXT,                     -- Nom de l'emprunteur (null si non prêté)
    loan_date INTEGER,                       -- Date du prêt
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_albums_isbn ON albums(isbn);
CREATE INDEX IF NOT EXISTS idx_albums_series_tome ON albums(series_id, tome_number);
```

### 4.3. Table `locations`
```sql
CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY NOT NULL,             -- UUID
    room TEXT NOT NULL,                      -- Pièce
    furniture TEXT NOT NULL,                 -- Meuble
    shelf TEXT,                              -- Étagère
    box_code TEXT,                           -- Casier / Code bac
    qr_code_token TEXT UNIQUE,               -- Token QR Code physique scannable
    max_capacity INTEGER DEFAULT 50          -- Capacité indicative
);
```

---

## 5. Algorithmes Métiers & Logique Critique

### 5.1. Normalisation & Vérification ISBN / EAN
- Suppression des tirets, espaces et caractères parasites.
- Si 10 chiffres (ancien ISBN) ➔ Conversion mathématique en ISBN-13 (préfixe `978` + recalcul de la clé de contrôle modulo 10).
- Rejet immédiat si la clé de contrôle modulo 10 est invalide avant tout appel base de données.

### 5.2. Moteur OCR de Couverture (`CoverOcrParser`)
- Nettoyage des textes parasites (mentions "Dargaud", "Dupuis", "Édition spéciale", codes prix).
- Extraction par Regex du numéro de tome : `(?:Tome|Vol|Volume|T\.?)\s*([0-9]{1,3})` ou chiffres arabes/romains isolés en haut de page.
- Comparaison de similarité (Levenshtein distance) avec la liste des séries de la base locale pour matcher le titre même en cas d'erreur sur 1 ou 2 caractères.

### 5.3. Cache Prédictif Série ("Série Complète en Local")
- Dès qu'un tome est scanné pour la première fois :
  1. Déclenchement d'un Worker asynchrone Ktor.
  2. Récupération de l'ensemble de la liste des tomes de cette série depuis Cloudflare D1.
  3. Enregistrement en base SQLite locale avec flag `is_owned = 0` pour les tomes non possédés.
  4. Résultat : lors des prochains scans sur la même série en brocante, la réponse est **100% instantanée (0 ms réseau)**.

---

## 6. Cas Limites & Résilience
1. **Intégrales et doubles tomes** : Un album unique regroupant les tomes 1, 2 et 3 ➔ marqué comme possédant les tomes 1 à 3 dans le calcul des manquants.
2. **Couverture détériorée ou sans titre** : Permettre la saisie vocale ou la recherche par auteur en 3 lettres.
3. **Absence de réseau prolongée** : La totalité des fonctionnalités d'ajout, de modification, d'inventaire et de recherche locale reste opérationnelle sans dégradation.
