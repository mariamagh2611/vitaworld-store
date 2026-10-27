ALTER TABLE products ADD COLUMN fulfillment INTEGER CHECK(fulfillment IS NULL OR fulfillment>=0);
UPDATE settings SET json=json_set(json,'$.supplierField','supplier_group_id','$.contractVerified',json('false')) WHERE COALESCE(json_extract(json,'$.supplierField'),'') IN ('','supplier_id');
UPDATE settings SET json=json_set(json,'$.citiesField','cities','$.cityNameField','city') WHERE COALESCE(json_extract(json,'$.citiesField'),'') IN ('','cities') AND COALESCE(json_extract(json,'$.cityNameField'),'') IN ('','name');
UPDATE products SET verified=0,revision=revision+1;
DELETE FROM sync_state WHERE name IN ('supplier_contract','catalog_pending','catalog_cursor');
