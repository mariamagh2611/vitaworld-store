CREATE TABLE categories ( id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '🛍️', position INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)) );
ALTER TABLE products ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX products_category ON products(category_id,active);
UPDATE products SET image='https://mowarid.ma' || image WHERE image LIKE '/api/media/%';
