import OpenAI from 'openai';
import { env } from '../../config/env.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface StreamUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StreamResult {
  usage: StreamUsage;
  toolCalls?: ToolCall[];
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string' &&
    err.message.trim()
  ) {
    return err.message.trim();
  }
  return '';
}

function isStreamOptionsCompatibilityError(err: unknown): boolean {
  return /not found|unsupported|stream_options|include_usage/i.test(getErrorMessage(err));
}

function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: env.OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': env.APP_URL,
      'X-Title': 'EchoSupport',
    },
  });
}

/**
 * Streams chat completion tokens via OpenRouter (or any OpenAI-compatible API).
 * Calls `onDelta` for each text token.
 * Returns usage stats and any tool_calls after the stream completes.
 */
export async function chatStream(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  onDelta: (token: string) => void,
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
): Promise<StreamResult> {
  const client = createClient(apiKey);

  const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model,
    messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    stream: true,
    stream_options: { include_usage: true },
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
  };

  let stream;
  try {
    stream = await client.chat.completions.create(request);
  } catch (err) {
    if (!isStreamOptionsCompatibilityError(err)) throw err;
    const fallbackRequest = { ...request };
    delete fallbackRequest.stream_options;
    stream = await client.chat.completions.create(fallbackRequest);
  }

  let tokensIn = 0;
  let tokensOut = 0;

  // Accumulate tool_call data from streaming chunks
  const toolCallAccumulators: Record<number, { id: string; name: string; argumentsRaw: string }> =
    {};

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) onDelta(delta.content);

    // Accumulate tool_calls
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallAccumulators[idx]) {
          toolCallAccumulators[idx] = {
            id: tc.id ?? '',
            name: tc.function?.name ?? '',
            argumentsRaw: '',
          };
        }
        if (tc.id) toolCallAccumulators[idx].id = tc.id;
        if (tc.function?.name) toolCallAccumulators[idx].name = tc.function.name;
        if (tc.function?.arguments) toolCallAccumulators[idx].argumentsRaw += tc.function.arguments;
      }
    }

    if (chunk.usage) {
      tokensIn = chunk.usage.prompt_tokens;
      tokensOut = chunk.usage.completion_tokens;
    }
  }

  const toolCalls: ToolCall[] = Object.values(toolCallAccumulators).map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments: (() => {
      try {
        return JSON.parse(tc.argumentsRaw) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
  }));

  return { usage: { tokensIn, tokensOut }, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
}

/**
 * Non-streaming chat completion — used for summarization.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
): Promise<string> {
  const client = createClient(apiKey);
  const response = await client.chat.completions.create({
    model,
    messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    stream: false,
  });
  return response.choices[0]?.message?.content ?? '';
}
