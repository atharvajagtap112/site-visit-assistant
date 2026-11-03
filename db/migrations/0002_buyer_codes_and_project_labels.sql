CREATE TABLE "otp_codes" (
	"phone" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "homes" text NOT NULL DEFAULT '2 BHK, 3 BHK';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "homes" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "price_range" text NOT NULL DEFAULT '₹65 lakh – ₹1.2 crore';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "price_range" DROP DEFAULT;
