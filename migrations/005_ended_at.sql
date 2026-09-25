-- When the subscription ended (canceled or unpaid), so synced data can be deleted 30 days
-- later (Privacy Policy). NULL while it is live. Old ended licences start from updated_at.
ALTER TABLE licences ADD COLUMN ended_at INTEGER;
UPDATE licences SET ended_at = updated_at WHERE status IN ('canceled', 'unpaid');
