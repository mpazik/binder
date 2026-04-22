DROP INDEX `config_created_at_idx`;--> statement-breakpoint
ALTER TABLE `configurations` ADD `tx_ids` blob DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `configurations_key_unique` ON `configurations` (`key`);--> statement-breakpoint
ALTER TABLE `configurations` DROP COLUMN `version`;--> statement-breakpoint
ALTER TABLE `configurations` DROP COLUMN `created_at`;--> statement-breakpoint
ALTER TABLE `configurations` DROP COLUMN `updated_at`;--> statement-breakpoint
ALTER TABLE `configurations` DROP COLUMN `deleted_at`;--> statement-breakpoint
DROP INDEX `node_created_at_idx`;--> statement-breakpoint
DROP INDEX `node_updated_at_idx`;--> statement-breakpoint
ALTER TABLE `nodes` ADD `tx_ids` blob DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_key_unique` ON `nodes` (`key`);--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `version`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `created_at`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `updated_at`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `deleted_at`;--> statement-breakpoint
CREATE INDEX `transactions_previous_idx` ON `transactions` (`previous`);--> statement-breakpoint
ALTER TABLE `transactions` DROP COLUMN `deleted_at`;