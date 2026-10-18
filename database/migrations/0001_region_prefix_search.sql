DROP INDEX "regions_name_lower_idx";--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "search_name" text GENERATED ALWAYS AS (lower(regexp_replace(name, '^(Kabupaten|Kota)( Administrasi)? ', ''))) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "regions_search_name_idx" ON "regions" USING btree ("search_name" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "regions_name_lower_idx" ON "regions" USING btree (lower("name") text_pattern_ops);