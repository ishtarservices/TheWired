/**
 * Tool registry + executor. Write tools are only advertised to the model when a
 * signer is present (read-only logins get reads only), and write execution is
 * re-checked at run time (defense in depth). The executor parses model-supplied
 * JSON args and dispatches to the matching ToolDef.
 */
import { store } from "@/store";
import type { ToolDefinition } from "../engine/types";
import type { ToolContext, ToolDef, ToolRunResult } from "./types";
import { READ_TOOLS } from "./readTools";
import { WRITE_TOOLS } from "./writeTools";
import { webSearchTool, isWebSearchConfigured } from "./webSearch";

// web_search is always resolvable by the executor; it's only ADVERTISED to the
// model when configured (see getActiveTools).
const ALL_TOOLS: ToolDef[] = [...READ_TOOLS, webSearchTool, ...WRITE_TOOLS];

function hasSigner(): boolean {
  const s = store.getState().identity;
  return s.signerType !== null && !!s.pubkey;
}

/** Tools to advertise this turn. Writes require a signer; web_search requires
 *  the feature enabled + a key loaded. */
export function getActiveTools(): ToolDef[] {
  const tools: ToolDef[] = [...READ_TOOLS];
  if (isWebSearchConfigured()) tools.push(webSearchTool);
  if (hasSigner()) tools.push(...WRITE_TOOLS);
  return tools;
}

export function toToolDefinitions(tools: ToolDef[]): ToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/** Execute one tool call. Never throws — errors come back as tool output. */
export async function runTool(
  name: string,
  argsJson: string,
  ctx: ToolContext,
): Promise<ToolRunResult> {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) return { output: `Error: unknown tool "${name}".`, isError: true };
  if (tool.access === "write" && !hasSigner()) {
    return { output: "Error: writing requires a signer; this account is read-only.", isError: true };
  }
  let args: Record<string, unknown> = {};
  if (argsJson && argsJson.trim()) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      return { output: `Error: arguments for ${name} were not valid JSON.`, isError: true };
    }
  }
  try {
    return await tool.run(args, ctx);
  } catch (e) {
    return {
      output: `Error running ${name}: ${e instanceof Error ? e.message : String(e)}`,
      isError: true,
    };
  }
}
