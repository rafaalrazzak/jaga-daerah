CREATE TYPE "public"."expenditure_type" AS ENUM('belanja_pegawai', 'belanja_barang_dan_jasa', 'belanja_modal', 'belanja_bunga', 'belanja_subsidi', 'belanja_hibah', 'belanja_bantuan_sosial', 'belanja_bagi_hasil', 'belanja_bantuan_keuangan', 'belanja_tidak_terduga');--> statement-breakpoint
CREATE TABLE "expenditure_breakdown_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expenditure_breakdown_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_version_id" integer NOT NULL,
	"region_id" integer NOT NULL,
	"year" smallint NOT NULL,
	"expenditure_type" "expenditure_type" NOT NULL,
	"budget_amount" numeric(20, 2),
	"realization_amount" numeric(20, 2),
	"source_id" integer NOT NULL,
	CONSTRAINT "expenditure_breakdown_facts_region_year_type_version_unique" UNIQUE("region_id","year","expenditure_type","dataset_version_id"),
	CONSTRAINT "expenditure_breakdown_facts_year_range" CHECK ("expenditure_breakdown_facts"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "expenditure_breakdown_facts_amounts_non_negative" CHECK (("expenditure_breakdown_facts"."budget_amount" IS NULL OR "expenditure_breakdown_facts"."budget_amount" >= 0)
        AND ("expenditure_breakdown_facts"."realization_amount" IS NULL OR "expenditure_breakdown_facts"."realization_amount" >= 0))
);
--> statement-breakpoint
ALTER TABLE "expenditure_breakdown_facts" ADD CONSTRAINT "expenditure_breakdown_facts_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "expenditure_breakdown_facts" ADD CONSTRAINT "expenditure_breakdown_facts_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "expenditure_breakdown_facts" ADD CONSTRAINT "expenditure_breakdown_facts_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "expenditure_breakdown_facts_version_region_year_idx" ON "expenditure_breakdown_facts" USING btree ("dataset_version_id","region_id","year");