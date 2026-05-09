import type { CLIOverrides } from "../launcher.js";
import type { ParsedCli, ParsedValues } from "../cli/parse.js";

export type CommandContext = {
  parsed: ParsedCli;
  values: ParsedValues;
  subcommand: string;
  args: string[];
  overrides: CLIOverrides;
};

export type CommandHandler = (context: CommandContext) => Promise<void>;
