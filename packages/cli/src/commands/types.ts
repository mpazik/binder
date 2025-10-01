import type { CommandModule } from "yargs";

export function types<T, U>(input: CommandModule<T, U>) {
  return input;
}
