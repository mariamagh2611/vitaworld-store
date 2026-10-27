ALTER TABLE products ADD COLUMN page_mode TEXT NOT NULL DEFAULT 'product' CHECK(page_mode IN ('product','landing'));
UPDATE products SET page_mode='landing' WHERE EXISTS(SELECT 1 FROM json_each(blocks) WHERE json_extract(value,'$.type') IN ('IMAGE','CTA'));
