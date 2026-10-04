CREATE TABLE `companies` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`price_sen` integer,
	`per` real,
	`pbr` real,
	`current_assets_sen` integer,
	`investment_securities_sen` integer,
	`total_liabilities_sen` integer,
	`previous_dividend_total_sen` integer,
	`fetched_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dividend_records` (
	`company_code` text NOT NULL,
	`fiscal_year` integer NOT NULL,
	`kind` text NOT NULL,
	`annual_amount_sen` integer,
	PRIMARY KEY(`company_code`, `fiscal_year`, `kind`),
	FOREIGN KEY (`company_code`) REFERENCES `companies`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `financial_records` (
	`company_code` text NOT NULL,
	`fiscal_year` integer NOT NULL,
	`is_forecast` integer NOT NULL,
	`eps_sen` integer,
	`roe_percent` real,
	`revenue_sen` integer,
	`operating_margin_percent` real,
	`dividend_per_share_sen` integer,
	PRIMARY KEY(`company_code`, `fiscal_year`, `is_forecast`),
	FOREIGN KEY (`company_code`) REFERENCES `companies`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `score_cards` (
	`company_code` text PRIMARY KEY NOT NULL,
	`total_score` integer NOT NULL,
	`effective_metric_count` integer NOT NULL,
	`calc_version` text NOT NULL,
	`calculated_at` text NOT NULL,
	FOREIGN KEY (`company_code`) REFERENCES `companies`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transformed_metrics` (
	`company_code` text NOT NULL,
	`metric_key` text NOT NULL,
	`score` integer,
	`value` real,
	`unavailable_reason` text,
	PRIMARY KEY(`company_code`, `metric_key`),
	FOREIGN KEY (`company_code`) REFERENCES `companies`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_transformed_metrics_metric` ON `transformed_metrics` (`metric_key`);