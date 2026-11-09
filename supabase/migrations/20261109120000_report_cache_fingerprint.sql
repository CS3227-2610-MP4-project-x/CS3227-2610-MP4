-- Task 8.2: cache reports against the complete assembled input and generation identity.
ALTER TABLE app.reports
  ADD COLUMN input_fingerprint text,
  ADD COLUMN generation_contract_version text,
  ADD COLUMN provider_model text;

ALTER TABLE app.reports
  ADD CONSTRAINT reports_input_fingerprint_format
    CHECK (input_fingerprint IS NULL OR input_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT reports_generation_identity_complete
    CHECK ((input_fingerprint IS NULL AND generation_contract_version IS NULL AND provider_model IS NULL)
        OR (input_fingerprint IS NOT NULL AND generation_contract_version IS NOT NULL AND provider_model IS NOT NULL));
