ALTER TABLE orders ADD COLUMN delivered_total INTEGER CHECK(delivered_total IS NULL OR delivered_total>=0);
UPDATE orders SET delivered_total=CAST(ROUND(json_extract(remote,'$.financials.total_cod_amount')*100) AS INTEGER) WHERE delivered_at IS NOT NULL AND json_type(remote,'$.financials.total_cod_amount') IN ('integer','real') AND json_extract(remote,'$.financials.total_cod_amount')>=0;
UPDATE orders SET delivered_total=CAST(json_extract(quote,'$.total') AS INTEGER) WHERE delivered_at IS NOT NULL AND delivered_total IS NULL;
