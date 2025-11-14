import type { McpTool } from "./types.ts";
import { schemaTool } from "./schema.ts";
import { searchTool } from "./search.ts";
import { transactTool } from "./transact.ts";

const coreTools: McpTool[] = [schemaTool, searchTool, transactTool];

export const getToolsForRequest = (): McpTool[] => coreTools;
