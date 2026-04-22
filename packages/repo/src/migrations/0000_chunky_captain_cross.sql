CREATE TABLE `configurations` (
	`id` integer PRIMARY KEY NOT NULL,
	`uid` text NOT NULL,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`fields` blob NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
) WITHOUT ROWID;
--> statement-breakpoint
CREATE UNIQUE INDEX `configurations_uid_unique` ON `configurations` (`uid`);--> statement-breakpoint
CREATE INDEX `config_uid_idx` ON `configurations` (`uid`);--> statement-breakpoint
CREATE INDEX `config_type_idx` ON `configurations` (`type`);--> statement-breakpoint
CREATE INDEX `config_key_idx` ON `configurations` (`key`);--> statement-breakpoint
CREATE INDEX `config_created_at_idx` ON `configurations` (`created_at`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` integer PRIMARY KEY NOT NULL,
	`uid` text NOT NULL,
	`key` text,
	`type` text NOT NULL,
	`fields` blob NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
) WITHOUT ROWID;
--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_uid_unique` ON `nodes` (`uid`);--> statement-breakpoint
CREATE INDEX `node_type_idx` ON `nodes` (`type`);--> statement-breakpoint
CREATE INDEX `node_key_idx` ON `nodes` (`key`);--> statement-breakpoint
CREATE INDEX `node_created_at_idx` ON `nodes` (`created_at`);--> statement-breakpoint
CREATE INDEX `node_updated_at_idx` ON `nodes` (`updated_at`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`previous` text NOT NULL,
	`configurations` blob NOT NULL,
	`nodes` blob NOT NULL,
	`author` text NOT NULL,
	`fields` blob NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text
) WITHOUT ROWID;
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_hash_unique` ON `transactions` (`hash`);--> statement-breakpoint
CREATE INDEX `transactions_created_at_idx` ON `transactions` (`created_at`);
