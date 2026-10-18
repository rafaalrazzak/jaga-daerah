CREATE TYPE "public"."disaster_type" AS ENUM('banjir', 'cuaca_ekstrem', 'erupsi_gunung_api', 'gelombang_pasang_abrasi', 'gempabumi', 'kebakaran_hutan_lahan', 'kekeringan', 'tanah_longsor', 'tsunami');--> statement-breakpoint
CREATE TYPE "public"."etl_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "budget_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "budget_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_version_id" integer NOT NULL,
	"region_id" integer NOT NULL,
	"year" smallint NOT NULL,
	"budget_amount" numeric(20, 2),
	"realization_amount" numeric(20, 2),
	"source_id" integer NOT NULL,
	CONSTRAINT "budget_facts_region_year_version_unique" UNIQUE("region_id","year","dataset_version_id"),
	CONSTRAINT "budget_facts_year_range" CHECK ("budget_facts"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "budget_facts_budget_non_negative" CHECK ("budget_facts"."budget_amount" IS NULL OR "budget_facts"."budget_amount" >= 0),
	CONSTRAINT "budget_facts_realization_non_negative" CHECK ("budget_facts"."realization_amount" IS NULL OR "budget_facts"."realization_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "disaster_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "disaster_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_version_id" integer NOT NULL,
	"province_id" integer NOT NULL,
	"year" smallint NOT NULL,
	"disaster_type" "disaster_type" NOT NULL,
	"event_count" integer,
	"deaths" integer,
	"missing" integer,
	"affected" integer,
	"source_id" integer NOT NULL,
	CONSTRAINT "disaster_facts_province_year_type_version_unique" UNIQUE("province_id","year","disaster_type","dataset_version_id"),
	CONSTRAINT "disaster_facts_year_range" CHECK ("disaster_facts"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "disaster_facts_counts_non_negative" CHECK (("disaster_facts"."event_count" IS NULL OR "disaster_facts"."event_count" >= 0)
        AND ("disaster_facts"."deaths" IS NULL OR "disaster_facts"."deaths" >= 0)
        AND ("disaster_facts"."missing" IS NULL OR "disaster_facts"."missing" >= 0)
        AND ("disaster_facts"."affected" IS NULL OR "disaster_facts"."affected" >= 0))
);
--> statement-breakpoint
CREATE TABLE "etl_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "etl_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_version_id" integer NOT NULL,
	"pipeline" text NOT NULL,
	"status" "etl_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_loaded" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "etl_runs_row_counts_non_negative" CHECK ("etl_runs"."rows_read" >= 0 AND "etl_runs"."rows_loaded" >= 0 AND "etl_runs"."rows_rejected" >= 0),
	CONSTRAINT "etl_runs_finished_when_done" CHECK ("etl_runs"."status" = 'running' OR "etl_runs"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "budget_facts" ADD CONSTRAINT "budget_facts_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "budget_facts" ADD CONSTRAINT "budget_facts_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "budget_facts" ADD CONSTRAINT "budget_facts_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "disaster_facts" ADD CONSTRAINT "disaster_facts_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "disaster_facts" ADD CONSTRAINT "disaster_facts_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "disaster_facts" ADD CONSTRAINT "disaster_facts_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "etl_runs" ADD CONSTRAINT "etl_runs_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "budget_facts_version_year_idx" ON "budget_facts" USING btree ("dataset_version_id","year");--> statement-breakpoint
CREATE INDEX "disaster_facts_version_year_idx" ON "disaster_facts" USING btree ("dataset_version_id","year");--> statement-breakpoint
CREATE INDEX "etl_runs_dataset_version_id_idx" ON "etl_runs" USING btree ("dataset_version_id");