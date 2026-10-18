CREATE TYPE "public"."dataset_status" AS ENUM('staging', 'active', 'retired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."region_type" AS ENUM('kabupaten', 'kota');--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_version_id" integer NOT NULL,
	"publisher" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text NOT NULL,
	"period" text NOT NULL,
	"downloaded_at" timestamp with time zone NOT NULL,
	"checksum_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_version_checksum_unique" UNIQUE("dataset_version_id","checksum_sha256"),
	CONSTRAINT "data_sources_checksum_format" CHECK ("data_sources"."checksum_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "data_sources_source_url_scheme" CHECK ("data_sources"."source_url" ~ '^https?://')
);
--> statement-breakpoint
CREATE TABLE "dataset_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dataset_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"version" text NOT NULL,
	"status" "dataset_status" DEFAULT 'staging' NOT NULL,
	"published_at" timestamp with time zone,
	"etl_started_at" timestamp with time zone,
	"etl_finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_versions_version_unique" UNIQUE("version"),
	CONSTRAINT "dataset_versions_active_has_published_at" CHECK ("dataset_versions"."status" <> 'active' OR "dataset_versions"."published_at" IS NOT NULL),
	CONSTRAINT "dataset_versions_etl_window_order" CHECK ("dataset_versions"."etl_finished_at" IS NULL OR "dataset_versions"."etl_started_at" IS NULL OR "dataset_versions"."etl_finished_at" >= "dataset_versions"."etl_started_at")
);
--> statement-breakpoint
CREATE TABLE "provinces" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "provinces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(2) NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provinces_code_unique" UNIQUE("code"),
	CONSTRAINT "provinces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "provinces_code_format" CHECK ("provinces"."code" ~ '^[0-9]{2}$'),
	CONSTRAINT "provinces_slug_format" CHECK ("provinces"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "regions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"province_id" integer NOT NULL,
	"code" varchar(5) NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "region_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_code_unique" UNIQUE("code"),
	CONSTRAINT "regions_slug_unique" UNIQUE("slug"),
	CONSTRAINT "regions_code_format" CHECK ("regions"."code" ~ '^[0-9]{2}\.[0-9]{2}$'),
	CONSTRAINT "regions_slug_format" CHECK ("regions"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_versions_single_active_idx" ON "dataset_versions" USING btree ("status") WHERE "dataset_versions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "regions_province_id_idx" ON "regions" USING btree ("province_id");--> statement-breakpoint
CREATE INDEX "regions_name_lower_idx" ON "regions" USING btree (lower("name"));