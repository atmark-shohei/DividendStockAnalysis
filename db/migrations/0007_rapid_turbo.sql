CREATE TABLE `user_indicator_settings` (
	`user_id` integer NOT NULL,
	`metric_key` text NOT NULL,
	`basis_value` real,
	PRIMARY KEY(`user_id`, `metric_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
