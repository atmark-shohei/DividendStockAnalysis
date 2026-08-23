CREATE TABLE `portfolio_holdings` (
	`portfolio_id` text NOT NULL,
	`company_code` text NOT NULL,
	`quantity` integer NOT NULL,
	`acquisition_price_sen` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`portfolio_id`, `company_code`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_code`) REFERENCES `companies`(`code`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_holdings_company_code` ON `portfolio_holdings` (`company_code`);--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_portfolios_user_id` ON `portfolios` (`user_id`);