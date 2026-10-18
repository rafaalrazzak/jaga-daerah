-- Grants the ETL role the writes it needs, and nothing more.
-- Apply after migrations, as the table owner. Create `jaga_etl` and its credential per environment.
-- No DELETE anywhere: missing region codes are deactivated, failed dataset versions stay as audit
-- records (status = 'failed') and are never visible to the API.

GRANT USAGE ON SCHEMA public TO jaga_etl;

-- Reference data (region codes).
GRANT SELECT, INSERT, UPDATE ON provinces, regions TO jaga_etl;
GRANT USAGE ON SEQUENCE provinces_id_seq, regions_id_seq TO jaga_etl;

-- Versioned publication: staging rows, provenance, run audit, and activation.
GRANT SELECT, INSERT, UPDATE ON dataset_versions, etl_runs TO jaga_etl;
GRANT SELECT, INSERT ON data_sources, budget_facts, disaster_facts, data_notes, natural_resource_revenue_facts, expenditure_breakdown_facts, expenditure_function_facts TO jaga_etl;
GRANT USAGE ON SEQUENCE
  dataset_versions_id_seq,
  data_sources_id_seq,
  budget_facts_id_seq,
  disaster_facts_id_seq,
  data_notes_id_seq,
  natural_resource_revenue_facts_id_seq,
  expenditure_breakdown_facts_id_seq,
  expenditure_function_facts_id_seq,
  etl_runs_id_seq
TO jaga_etl;
