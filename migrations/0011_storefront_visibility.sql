ALTER TABLE products ADD COLUMN storefront_visible INTEGER NOT NULL DEFAULT 1 CHECK(storefront_visible IN (0,1));
ALTER TABLE products ADD COLUMN gallery TEXT NOT NULL DEFAULT '[]';
CREATE INDEX idx_products_storefront ON products(active,storefront_visible,featured,name);
