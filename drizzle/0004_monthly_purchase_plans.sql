CREATE TABLE `monthly_purchase_plans` (
	`key` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`period_label` text NOT NULL,
	`payload` text NOT NULL,
	`imported_by` text NOT NULL,
	`imported_at` text NOT NULL
);
