ALTER TABLE `app_users` ADD `username` text;--> statement-breakpoint
ALTER TABLE `app_users` ADD `password_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_username_uq` ON `app_users` (`username`);