ALTER TABLE delivery_outbox ADD COLUMN delivered_at bigint;
ALTER TABLE delivery_outbox ADD COLUMN next_at bigint NOT NULL DEFAULT 0;
ALTER TABLE delivery_outbox ADD COLUMN lease_owner text;
ALTER TABLE delivery_outbox ADD COLUMN lease_until bigint;
ALTER TABLE delivery_outbox ADD COLUMN attempts integer NOT NULL DEFAULT 0;
CREATE INDEX delivery_due ON delivery_outbox(next_at) WHERE delivered_at IS NULL;
CREATE INDEX throttle_expiry ON throttle(expires_at);
CREATE INDEX memberships_user ON memberships(user_id) WHERE active=true;
CREATE INDEX recoveries_user ON recoveries(user_id);
