CREATE TABLE `edinet_document_index` (
	`company_code` text NOT NULL,
	`fiscal_year` integer NOT NULL,
	`doc_id` text NOT NULL,
	`submitted_at` text NOT NULL,
	PRIMARY KEY(`company_code`, `fiscal_year`)
);
--> statement-breakpoint
CREATE INDEX `idx_edinet_document_index_company` ON `edinet_document_index` (`company_code`);--> statement-breakpoint
CREATE TABLE `edinet_refresh_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`refreshed_at` text NOT NULL,
	`entry_count` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `companies` ADD `eps_history_restated` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `companies` ADD `revenue_history_restated` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `companies` ADD `bs_source_doc_id` text;--> statement-breakpoint
ALTER TABLE `financial_records` ADD `source_doc_id` text;