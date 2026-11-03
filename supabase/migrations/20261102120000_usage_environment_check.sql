-- Task 6.3 (llm-gateway-core): usage_records constraints and charged tokens.
-- Environment Decisions E6; LLM Gateway Decisions "Task 6.3 handoff decisions" Q1, Q5, Q6.
-- Run after the D-L pre-migration backup. Constraints are added and validated in place,
-- because no other values are ever written. app_runtime's existing table-level grants
-- (D-J) cover the new column.

ALTER TABLE app.usage_records
  ADD COLUMN charged_tokens integer;

ALTER TABLE app.usage_records
  ADD CONSTRAINT usage_records_charged_tokens_not_negative CHECK (charged_tokens >= 0);

ALTER TABLE app.usage_records
  ADD CONSTRAINT usage_records_environment_valid CHECK (environment IN ('development', 'production'));

ALTER TABLE app.usage_records
  ADD CONSTRAINT usage_records_feature_valid CHECK (feature IN ('acceptance_check', 'progress_report'));
