CREATE TABLE `cli_snapshot_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`tx_id` integer NOT NULL,
	`mtime` integer NOT NULL,
	`size` integer NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cli_snapshot_metadata_path_unique` ON `cli_snapshot_metadata` (`path`);--> statement-breakpoint
CREATE INDEX `cli_snapshot_path_idx` ON `cli_snapshot_metadata` (`path`);--> statement-breakpoint
CREATE INDEX `cli_snapshot_tx_idx` ON `cli_snapshot_metadata` (`tx_id`);