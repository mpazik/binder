import type { Argv } from "yargs";
import { Log } from "../log.ts";
import { types } from "./types.ts";

export const RunCommand = types({
  command: "run [message..]",
  describe: "run with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      });
  },
  handler: async (args) => {
    const message = args.message.join(" ");

    Log.info(message);
  },
});
