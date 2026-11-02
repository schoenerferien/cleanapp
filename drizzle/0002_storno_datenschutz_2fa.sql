CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "kind" text DEFAULT 'rechnung' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancels_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "retention_time_months" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "retention_gps_months" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "retention_photo_months" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "failed_logins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "two_factor_user_id_index" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_index" ON "two_factor" USING btree ("secret");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancels_invoice_id_invoices_id_fk" FOREIGN KEY ("cancels_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_cancels_invoice_id_index" ON "invoices" USING btree ("cancels_invoice_id");