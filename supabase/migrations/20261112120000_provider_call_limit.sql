-- Acceptance-check provider-key permits. Rows store only a one-way credential fingerprint.
CREATE TABLE app.provider_call_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_fingerprint char(64) NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT provider_call_permits_fingerprint_sha256
    CHECK (key_fingerprint ~ '^[a-f0-9]{64}$')
);

CREATE INDEX provider_call_permits_key_time_idx
  ON app.provider_call_permits (key_fingerprint, acquired_at);

REVOKE ALL ON TABLE app.provider_call_permits FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON TABLE app.provider_call_permits FROM service_role;
  END IF;
END
$$;

GRANT SELECT, INSERT ON TABLE app.provider_call_permits TO app_runtime;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE app.provider_call_permits FROM app_runtime;
