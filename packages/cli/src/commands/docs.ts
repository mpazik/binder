import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import { bootstrapWithDb, type CommandHandlerWithDb } from "../bootstrap.ts";
import { renderDocs } from "../document/repository.ts";
import { types } from "./types.ts";

export const docsRenderHandler: CommandHandlerWithDb = async ({
  kg,
  ui,
  config: { docsPath, dynamicDirectories },
}) => {
  const result = await renderDocs(kg, docsPath, dynamicDirectories);
  if (isErr(result)) return result;

  ui.println("Documentation rendered successfully");
  return ok(undefined);
};

const DocsCommand = types({
  command: "docs <command>",
  describe: "manage documentation",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "render",
          describe: "render documents to markdown files",
          handler: bootstrapWithDb(docsRenderHandler),
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: refresh, render");
  },
  handler: async () => {},
});
export default DocsCommand;
