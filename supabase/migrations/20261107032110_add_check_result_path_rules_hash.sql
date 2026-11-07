-- Include the normalized path-rules configuration in check-result cache identity.
-- Existing rows remain available as history and intentionally retain NULL because
-- their path-rules configuration cannot be reconstructed safely.
ALTER TABLE app.check_results
  ADD COLUMN path_rules_hash text,
  ADD CONSTRAINT check_results_path_rules_hash_sha256_hex
    CHECK (path_rules_hash IS NULL OR path_rules_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE app.check_results
  DROP CONSTRAINT check_results_reuse_key;

CREATE UNIQUE INDEX check_results_reuse_key_legacy_idx
  ON app.check_results (task_id, commit_set_hash, criteria_hash)
  WHERE path_rules_hash IS NULL;

CREATE UNIQUE INDEX check_results_reuse_key_with_path_rules_idx
  ON app.check_results (task_id, commit_set_hash, criteria_hash, path_rules_hash)
  WHERE path_rules_hash IS NOT NULL;
