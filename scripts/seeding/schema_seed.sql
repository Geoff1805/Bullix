-- ============================================================================
-- Données d'amorçage de test (Seed) pour Cloudflare D1
-- Exemple représentatif des données extraites de BDthèque & BDvore
-- ============================================================================

-- 1. SÉRIE : Astérix
INSERT OR IGNORE INTO series (id, title, type, status, total_volumes, publisher_default, created_at, updated_at)
VALUES ('series_asterix', 'Astérix', 'Franco-belge', 'En cours', 40, 'Albert René / Dargaud', 1700000000000, 1700000000000);

INSERT OR IGNORE INTO albums (id, series_id, volume_number, title, isbn, authors, publisher, published_year, cover_image_url, created_at, updated_at)
VALUES 
('alb_ast_01', 'series_asterix', 1, 'Astérix le Gaulois', '9782012101333', 'Goscinny, Uderzo', 'Dargaud', 1961, 'https://covers.openlibrary.org/b/isbn/9782012101333-L.jpg', 1700000000000, 1700000000000),
('alb_ast_02', 'series_asterix', 2, 'La Serpe d''or', '9782012101340', 'Goscinny, Uderzo', 'Dargaud', 1962, 'https://covers.openlibrary.org/b/isbn/9782012101340-L.jpg', 1700000000000, 1700000000000),
('alb_ast_03', 'series_asterix', 3, 'Astérix et les Goths', '9782012101357', 'Goscinny, Uderzo', 'Dargaud', 1963, 'https://covers.openlibrary.org/b/isbn/9782012101357-L.jpg', 1700000000000, 1700000000000),
('alb_ast_04', 'series_asterix', 4, 'Astérix Gladiateur', '9782012101364', 'Goscinny, Uderzo', 'Dargaud', 1964, 'https://covers.openlibrary.org/b/isbn/9782012101364-L.jpg', 1700000000000, 1700000000000),
('alb_ast_40', 'series_asterix', 40, 'L''Iris blanc', '9782069975413', 'Fabcaro, Didier Conrad', 'Albert René', 2023, 'https://covers.openlibrary.org/b/isbn/9782069975413-L.jpg', 1700000000000, 1700000000000);

-- 2. SÉRIE : Blacksad
INSERT OR IGNORE INTO series (id, title, type, status, total_volumes, publisher_default, created_at, updated_at)
VALUES ('series_blacksad', 'Blacksad', 'Franco-belge', 'En cours', 7, 'Dargaud', 1700000000000, 1700000000000);

INSERT OR IGNORE INTO albums (id, series_id, volume_number, title, isbn, authors, publisher, published_year, cover_image_url, created_at, updated_at)
VALUES 
('alb_bs_01', 'series_blacksad', 1, 'Quelque part entre les ombres', '9782205049657', 'Juan Díaz Canales, Juanjo Guarnido', 'Dargaud', 2000, 'https://covers.openlibrary.org/b/isbn/9782205049657-L.jpg', 1700000000000, 1700000000000),
('alb_bs_02', 'series_blacksad', 2, 'Arctic-Nation', '9782205053470', 'Juan Díaz Canales, Juanjo Guarnido', 'Dargaud', 2003, 'https://covers.openlibrary.org/b/isbn/9782205053470-L.jpg', 1700000000000, 1700000000000),
('alb_bs_03', 'series_blacksad', 3, 'Âme Rouge', '9782205055641', 'Juan Díaz Canales, Juanjo Guarnido', 'Dargaud', 2005, 'https://covers.openlibrary.org/b/isbn/9782205055641-L.jpg', 1700000000000, 1700000000000);

-- 3. SÉRIE : One Piece
INSERT OR IGNORE INTO series (id, title, type, status, total_volumes, publisher_default, created_at, updated_at)
VALUES ('series_one_piece', 'One Piece', 'Manga', 'En cours', 108, 'Glénat', 1700000000000, 1700000000000);

INSERT OR IGNORE INTO albums (id, series_id, volume_number, title, isbn, authors, publisher, published_year, cover_image_url, created_at, updated_at)
VALUES 
('alb_op_01', 'series_one_piece', 1, 'Romance Dawn', '9782723433358', 'Eiichiro Oda', 'Glénat', 2000, 'https://covers.openlibrary.org/b/isbn/9782723433358-L.jpg', 1700000000000, 1700000000000),
('alb_op_02', 'series_one_piece', 2, 'Luffy versus la bande à Baggy', '9782723434775', 'Eiichiro Oda', 'Glénat', 2001, 'https://covers.openlibrary.org/b/isbn/9782723434775-L.jpg', 1700000000000, 1700000000000);
