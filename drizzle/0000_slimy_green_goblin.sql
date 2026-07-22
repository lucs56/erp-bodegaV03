CREATE TABLE `bom_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`material_code` text NOT NULL,
	`material_name` text NOT NULL,
	`category` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'unidad' NOT NULL,
	`action` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bom_product_material_action_uq` ON `bom_items` (`product_id`,`material_code`,`action`);--> statement-breakpoint
CREATE TABLE `bom_substitutes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bom_item_id` integer NOT NULL,
	`material_code` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`bom_item_id`) REFERENCES `bom_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bom_substitute_uq` ON `bom_substitutes` (`bom_item_id`,`material_code`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_uq` ON `products` (`code`);