ALTER TABLE `configurations` RENAME TO `configs`;--> statement-breakpoint
ALTER TABLE `nodes` RENAME TO `records`;--> statement-breakpoint
ALTER TABLE `transactions` RENAME COLUMN "configurations" TO "configs";--> statement-breakpoint
ALTER TABLE `transactions` RENAME COLUMN "nodes" TO "records";--> statement-breakpoint
DROP INDEX `configurations_uid_unique`;--> statement-breakpoint
DROP INDEX `configurations_key_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `configs_uid_unique` ON `configs` (`uid`);--> statement-breakpoint
CREATE UNIQUE INDEX `configs_key_unique` ON `configs` (`key`);--> statement-breakpoint
DROP INDEX `nodes_uid_unique`;--> statement-breakpoint
DROP INDEX `nodes_key_unique`;--> statement-breakpoint
DROP INDEX `node_type_idx`;--> statement-breakpoint
DROP INDEX `node_key_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `records_uid_unique` ON `records` (`uid`);--> statement-breakpoint
CREATE UNIQUE INDEX `records_key_unique` ON `records` (`key`);--> statement-breakpoint
CREATE INDEX `record_type_idx` ON `records` (`type`);--> statement-breakpoint
CREATE INDEX `record_key_idx` ON `records` (`key`);--> statement-breakpoint
ALTER TABLE `configs` ADD `tags` blob DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `records` ADD `tags` blob DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `tags` blob DEFAULT '[]' NOT NULL;