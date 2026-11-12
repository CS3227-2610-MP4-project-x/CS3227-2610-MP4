-- Task 8.3 D9: keep verified replacement totals without secret values.
ALTER TABLE app.reports
  ADD COLUMN redaction_replacement_count integer;

ALTER TABLE app.reports
  ADD CONSTRAINT reports_redaction_replacement_count_nonnegative
    CHECK (redaction_replacement_count IS NULL OR redaction_replacement_count >= 0);
