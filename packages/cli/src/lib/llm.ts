import {
  complete as piComplete,
  getEnvApiKey as piGetEnvApiKey,
  getModel as piGetModel,
  validateToolCall,
  type AssistantMessage,
  type Context,
  type Model,
  type Static,
  type Tool,
  type TSchema,
} from "@mariozechner/pi-ai";
import {
  fail,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
  wrapError,
} from "@binder/utils";
import type { RuntimeContext } from "../runtime.ts";
import { resolveLlmConfig } from "../config.ts";
import { appendLlmLog, type LlmLogEntry } from "./llm-log.ts";

export type LlmCallParams<S extends TSchema | undefined = undefined> = {
  systemPrompt?: string;
  userPrompt: string;
  /** When set, the model is forced to call a single tool whose parameters match this TypeBox schema; the validated arguments are returned as `data`. */
  schema?: S;
};

export type LlmUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costTotal: number;
};

export type LlmResult<T> = {
  data: T;
  usage: LlmUsage;
  provider: string;
  model: string;
};

type CallLlmReturn<S extends TSchema | undefined> = S extends TSchema
  ? LlmResult<Static<S>>
  : LlmResult<string>;

/**
 * Provider → API-key env var names known by pi-ai. Used to give a clear
 * error message when the env var is missing. Mirrored from pi-ai's
 * internal map; keep in sync if pi-ai adds providers.
 */
const PROVIDER_ENV_VARS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "azure-openai-responses": ["AZURE_OPENAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  google: ["GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_CLOUD_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
  zai: ["ZAI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  huggingface: ["HF_TOKEN"],
  fireworks: ["FIREWORKS_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY"],
  "github-copilot": ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
};

/** Test seam: dependencies callLlm uses to talk to pi-ai. */
export type LlmDeps = {
  getModel: (provider: string, modelId: string) => Model<string>;
  complete: (
    model: Model<string>,
    context: Context,
  ) => Promise<AssistantMessage>;
  getEnvApiKey: (provider: string) => string | undefined;
};

const defaultDeps: LlmDeps = {
  getModel: (provider, modelId) =>
    piGetModel(provider as never, modelId as never),
  complete: (model, context) => piComplete(model, context),
  getEnvApiKey: (provider) => piGetEnvApiKey(provider as never),
};

const STRUCTURED_TOOL_NAME = "respond";

const extractText = (msg: AssistantMessage): string =>
  msg.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

const extractToolCall = (msg: AssistantMessage, name: string) =>
  msg.content.find(
    (
      b,
    ): b is Extract<
      AssistantMessage["content"][number],
      { type: "toolCall" }
    > => b.type === "toolCall" && b.name === name,
  );

/**
 * Make one LLM call for `operation`. Resolves provider+model from
 * `ctx.config.llm`, verifies the API key env var is set, calls pi-ai's
 * `complete()`, and appends a JSONL entry to `<binder>/logs/llm.jsonl`
 * for both success and failure.
 *
 * When `params.schema` is provided, the model is forced to invoke a
 * single `respond` tool whose parameters match the schema; the validated
 * tool arguments are returned as `data`. Otherwise `data` is the
 * concatenated text content of the response.
 */
export const callLlm = async <S extends TSchema | undefined = undefined>(
  ctx: RuntimeContext,
  operation: string,
  params: LlmCallParams<S>,
  deps: LlmDeps = defaultDeps,
): ResultAsync<CallLlmReturn<S>> => {
  const start = Date.now();
  const ts = new Date(start).toISOString();
  const binderDir = ctx.config.paths.binder;

  const resolved = resolveLlmConfig(ctx.config.llm, operation);
  if (!resolved)
    return fail(
      "llm-config-missing",
      `No LLM provider/model configured for operation "${operation}". ` +
        `Set llm.default or llm.operations.${operation} in config.yaml ` +
        `with both provider and model fields.`,
      { data: { operation } },
    );

  const { provider, model: modelId } = resolved;

  const logFailure = async (key: string, message: string): Promise<void> => {
    await appendLlmLog(ctx.fs, binderDir, {
      ts,
      operation,
      provider,
      model: modelId,
      durationMs: Date.now() - start,
      ok: false,
      error: { key, message },
    });
  };

  if (!deps.getEnvApiKey(provider)) {
    const envKeys = PROVIDER_ENV_VARS[provider] ?? [];
    const hint =
      envKeys.length > 0
        ? `Set one of: ${envKeys.join(", ")}.`
        : `No known API-key env var for provider "${provider}".`;
    await logFailure("llm-api-key-missing", hint);
    return fail(
      "llm-api-key-missing",
      `Missing API key for provider "${provider}". ${hint}`,
      { data: { provider, envKeys } },
    );
  }

  const modelResult = tryCatch(() => deps.getModel(provider, modelId));
  if (isErr(modelResult)) {
    await logFailure("llm-config-missing", modelResult.error.message);
    return fail(
      "llm-config-missing",
      `Unknown LLM model "${modelId}" for provider "${provider}": ${modelResult.error.message}`,
      { data: { provider, model: modelId } },
    );
  }
  const model = modelResult.data;

  const tools: Tool[] | undefined = params.schema
    ? [
        {
          name: STRUCTURED_TOOL_NAME,
          description:
            "Submit the structured response. Always call this tool exactly once.",
          parameters: params.schema,
        },
      ]
    : undefined;

  const context: Context = {
    systemPrompt: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt, timestamp: start }],
    tools,
  };

  const completeResult = await tryCatch(() => deps.complete(model, context));
  if (isErr(completeResult)) {
    await logFailure(
      "llm-call-failed",
      completeResult.error.message ?? "unknown",
    );
    return wrapError(completeResult, "llm-call-failed", "LLM call failed", {
      data: { provider, model: modelId, operation },
    });
  }

  const message = completeResult.data;
  const usage: LlmUsage = {
    input: message.usage.input,
    output: message.usage.output,
    cacheRead: message.usage.cacheRead,
    cacheWrite: message.usage.cacheWrite,
    costTotal: message.usage.cost.total,
  };

  let data: unknown;
  if (params.schema) {
    const toolCall = extractToolCall(message, STRUCTURED_TOOL_NAME);
    if (!toolCall) {
      await logFailure(
        "llm-schema-invalid",
        `Model did not invoke "${STRUCTURED_TOOL_NAME}" tool`,
      );
      return fail(
        "llm-schema-invalid",
        `Model did not return structured output (no "${STRUCTURED_TOOL_NAME}" tool call).`,
        { data: { stopReason: message.stopReason } },
      );
    }
    const validation = tryCatch(() =>
      validateToolCall(tools!, {
        type: "toolCall",
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      }),
    );
    if (isErr(validation)) {
      await logFailure(
        "llm-schema-invalid",
        validation.error.message ?? "validation failed",
      );
      return wrapError(
        validation,
        "llm-schema-invalid",
        "LLM structured output failed schema validation",
        { data: { provider, model: modelId, operation } },
      );
    }
    data = validation.data;
  } else {
    data = extractText(message);
  }

  const successEntry: LlmLogEntry = {
    ts,
    operation,
    provider,
    model: modelId,
    tokens: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
    },
    cost: { total: usage.costTotal },
    durationMs: Date.now() - start,
    ok: true,
  };
  await appendLlmLog(ctx.fs, binderDir, successEntry);

  return ok({
    data,
    usage,
    provider,
    model: modelId,
  } as CallLlmReturn<S>);
};
