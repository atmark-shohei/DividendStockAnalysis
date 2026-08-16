CREATE TABLE `edinet_document_summary` (
	`doc_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`payload` text NOT NULL,
	`cached_at` text NOT NULL
);
