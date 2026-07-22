CREATE TABLE `stock_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_code` text NOT NULL,
	`material_name` text NOT NULL,
	`category` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'unidad' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_material_uq` ON `stock_items` (`material_code`);