CREATE TYPE "public"."natural_resource_type" AS ENUM('minyak_bumi', 'gas_bumi', 'minerba', 'kehutanan', 'perikanan', 'panas_bumi', 'perkebunan_sawit');--> statement-breakpoint
CREATE TABLE "natural_resource_revenue_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "natural_resource_revenue_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_version_id" integer NOT NULL,
	"region_id" integer NOT NULL,
	"year" smallint NOT NULL,
	"resource_type" "natural_resource_type" NOT NULL,
	"budget_amount" numeric(20, 2),
	"realization_amount" numeric(20, 2),
	"source_id" integer NOT NULL,
	CONSTRAINT "natural_resource_facts_region_year_type_version_unique" UNIQUE("region_id","year","resource_type","dataset_version_id"),
	CONSTRAINT "natural_resource_facts_year_range" CHECK ("natural_resource_revenue_facts"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "natural_resource_facts_amounts_non_negative" CHECK (("natural_resource_revenue_facts"."budget_amount" IS NULL OR "natural_resource_revenue_facts"."budget_amount" >= 0)
        AND ("natural_resource_revenue_facts"."realization_amount" IS NULL OR "natural_resource_revenue_facts"."realization_amount" >= 0))
);
--> statement-breakpoint
ALTER TABLE "natural_resource_revenue_facts" ADD CONSTRAINT "natural_resource_revenue_facts_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "natural_resource_revenue_facts" ADD CONSTRAINT "natural_resource_revenue_facts_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "natural_resource_revenue_facts" ADD CONSTRAINT "natural_resource_revenue_facts_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "natural_resource_facts_version_region_year_idx" ON "natural_resource_revenue_facts" USING btree ("dataset_version_id","region_id","year");