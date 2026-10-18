CREATE TABLE "data_notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_version_id" integer NOT NULL,
	"year" smallint NOT NULL,
	"disaster_type" "disaster_type",
	"metric" text NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "data_notes_year_range" CHECK ("data_notes"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "data_notes_metric_known" CHECK ("data_notes"."metric" IN ('event_count', 'deaths', 'missing', 'affected', 'budget_amount', 'realization_amount'))
);
--> statement-breakpoint
ALTER TABLE "data_notes" ADD CONSTRAINT "data_notes_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "data_notes_version_year_idx" ON "data_notes" USING btree ("dataset_version_id","year");