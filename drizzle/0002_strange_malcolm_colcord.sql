CREATE TABLE `app_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'planner' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`permissions` text DEFAULT 'programacion,productos,bom,consumos,stock,faltantes,compras' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_email_uq` ON `app_users` (`email`);