-- ============================================================================
-- Bullix Database Schema (Cloudflare D1 & SQLite)
-- ============================================================================

-- SÉRIES : Le regroupement logique d'une saga de bandes dessinées
CREATE TABLE IF NOT EXISTS series (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('Franco-belge', 'Manga', 'Comics', 'Autre')) DEFAULT 'Franco-belge',
    status TEXT CHECK(status IN ('En cours', 'Terminée', 'Abandonnée', 'Inconnue')) DEFAULT 'En cours',
    total_volumes INTEGER DEFAULT NULL,
    publisher_default TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_series_title ON series(title);
CREATE INDEX IF NOT EXISTS idx_series_updated_at ON series(updated_at);

-- ALBUMS : Le catalogue des éditions existantes
CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY NOT NULL,
    series_id TEXT NOT NULL,
    volume_number REAL NOT NULL,
    title TEXT,
    isbn TEXT,
    upc TEXT,
    authors TEXT,
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
CREATE INDEX IF NOT EXISTS idx_albums_updated_at ON albums(updated_at);

-- EMPLACEMENTS : Arborescence de rangement physique
CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    qr_code_ref TEXT UNIQUE,
    color_tag TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_locations_user ON locations(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_qr ON locations(qr_code_ref);
CREATE INDEX IF NOT EXISTS idx_locations_updated_at ON locations(updated_at);

-- COLLECTION UTILISATEUR : Jonction de possession physique
CREATE TABLE IF NOT EXISTS user_collection (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    album_id TEXT NOT NULL,
    location_id TEXT,
    condition TEXT CHECK(condition IN ('Neuf', 'Très bon', 'Bon', 'Passable', 'Mauvais', 'Lu')),
    edition_info TEXT,
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
CREATE INDEX IF NOT EXISTS idx_user_collection_updated_at ON user_collection(updated_at);

-- REGISTRE DE SYNCHRONISATION (Journal des mutations pour Cloudflare Sync)
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    sync_status TEXT DEFAULT 'SYNCED',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_updated_at ON records(updated_at);
CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
CREATE INDEX IF NOT EXISTS idx_records_entity ON records(entity_type, user_id);
