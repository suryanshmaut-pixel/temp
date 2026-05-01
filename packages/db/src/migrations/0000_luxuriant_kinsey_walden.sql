CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"transcript_id" text NOT NULL,
	"run_id" text NOT NULL,
	"extraction_result_id" text,
	"schema_valid" boolean NOT NULL,
	"field_scores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aggregate_score" double precision NOT NULL,
	"aggregate_f1" double precision NOT NULL,
	"hallucinations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hallucination_count" integer NOT NULL,
	"gold" jsonb NOT NULL,
	"prediction" jsonb,
	"evaluated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy" text NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"total_cases" integer NOT NULL,
	"completed_cases" integer DEFAULT 0 NOT NULL,
	"failed_cases" integer DEFAULT 0 NOT NULL,
	"schema_failure_count" integer DEFAULT 0 NOT NULL,
	"hallucination_count" integer DEFAULT 0 NOT NULL,
	"aggregate_score" double precision,
	"aggregate_f1" double precision,
	"field_aggregates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_usage" jsonb NOT NULL,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"cache_read_verified" boolean DEFAULT false NOT NULL,
	"dataset_filter" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "extraction_results" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"transcript_id" text NOT NULL,
	"run_id" text,
	"strategy" text NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"extraction" jsonb,
	"schema_valid" boolean NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_usage" jsonb NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_evaluations" ADD CONSTRAINT "case_evaluations_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_evaluations" ADD CONSTRAINT "case_evaluations_extraction_result_id_extraction_results_id_fk" FOREIGN KEY ("extraction_result_id") REFERENCES "public"."extraction_results"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD CONSTRAINT "extraction_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "case_evaluations_run_id_idx" ON "case_evaluations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_evaluations_run_case_idx" ON "case_evaluations" USING btree ("run_id","case_id");--> statement-breakpoint
CREATE INDEX "eval_runs_status_idx" ON "eval_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "eval_runs_started_at_idx" ON "eval_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "extraction_results_run_id_idx" ON "extraction_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "extraction_results_cache_key_idx" ON "extraction_results" USING btree ("strategy","model","transcript_id","prompt_hash");