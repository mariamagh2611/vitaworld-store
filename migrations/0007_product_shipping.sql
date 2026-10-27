ALTER TABLE products ADD COLUMN shipping_casa INTEGER CHECK(shipping_casa IS NULL OR (shipping_casa>=0 AND shipping_casa<=100000));
ALTER TABLE products ADD COLUMN shipping_other INTEGER CHECK(shipping_other IS NULL OR (shipping_other>=0 AND shipping_other<=100000));
