CREATE TYPE "public"."expenditure_function" AS ENUM('pelayanan_umum', 'ketertiban_dan_keamanan', 'ekonomi', 'perlindungan_lingkungan_hidup', 'perumahan_dan_fasilitas_umum', 'kesehatan', 'pariwisata', 'pendidikan', 'perlindungan_sosial');--> statement-breakpoint
CREATE TABLE "expenditure_function_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expenditure_function_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_version_id" integer NOT NULL,
	"region_id" integer NOT NULL,
	"year" smallint NOT NULL,
	"function_type" "expenditure_function" NOT NULL,
	"budget_amount" numeric(20, 2),
	"realization_amount" numeric(20, 2),
	"source_id" integer NOT NULL,
	CONSTRAINT "expenditure_function_facts_region_year_type_version_unique" UNIQUE("region_id","year","function_type","dataset_version_id"),
	CONSTRAINT "expenditure_function_facts_year_range" CHECK ("expenditure_function_facts"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "expenditure_function_facts_amounts_non_negative" CHECK (("expenditure_function_facts"."budget_amount" IS NULL OR "expenditure_function_facts"."budget_amount" >= 0)
        AND ("expenditure_function_facts"."realization_amount" IS NULL OR "expenditure_function_facts"."realization_amount" >= 0))
);
--> statement-breakpoint
ALTER TABLE "expenditure_function_facts" ADD CONSTRAINT "expenditure_function_facts_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "expenditure_function_facts" ADD CONSTRAINT "expenditure_function_facts_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "expenditure_function_facts" ADD CONSTRAINT "expenditure_function_facts_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "expenditure_function_facts_version_region_year_idx" ON "expenditure_function_facts" USING btree ("dataset_version_id","region_id","year");