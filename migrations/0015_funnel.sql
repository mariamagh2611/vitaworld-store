ALTER TABLE visits ADD COLUMN stage TEXT NOT NULL DEFAULT 'visit';
ALTER TABLE visits ADD COLUMN attribution TEXT NOT NULL DEFAULT '{}';
CREATE INDEX visits_funnel ON visits(date,source,campaign,stage);
