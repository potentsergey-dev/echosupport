# Local Models and OpenAI-Compatible Endpoints

EchoSupport can use OpenRouter by default, but the backend chat and embedding clients are built on
OpenAI-compatible APIs. This means you can point the global provider URL to a local or self-hosted
endpoint such as Ollama, vLLM, LM Studio, or another compatible gateway.

## Recommended starting point

Keep OpenRouter as the default for most installs. It is simpler, works on small VPS instances, and
usually gives better latency without GPU setup.

Use a local model when you need:

- stronger data-control requirements;
- predictable infrastructure ownership;
- experimentation with private models;
- a GPU server that can run the model comfortably.

A small CPU-only VPS can run tiny models, but answers will often be slow. For production use, prefer
a GPU server or keep OpenRouter as the chat provider.

## Global compatible endpoint

Set these variables in `.env` before rebuilding:

```env
OPENROUTER_BASE_URL=http://127.0.0.1:11434/v1
OPENROUTER_API_KEY=ollama
```

Then set the agent LLM model to a model available on that endpoint, for example:

```text
llama3.1:8b
```

For Docker deployments, remember that `127.0.0.1` inside the backend container is the backend
container itself. Use the reachable host address for your setup. On Docker Desktop this is often:

```env
OPENROUTER_BASE_URL=http://host.docker.internal:11434/v1
```

On a Linux VPS, the cleanest production option is usually to run the compatible endpoint in Docker
Compose on the same Docker network and use the service name, for example:

```env
OPENROUTER_BASE_URL=http://ollama:11434/v1
OPENROUTER_API_KEY=ollama
```

## Embeddings

Knowledge indexing needs an embeddings endpoint. You have two practical options:

1. Keep embeddings on OpenRouter/OpenAI and run only chat locally.
2. Use a local endpoint that supports `/v1/embeddings` and set:

```env
OPENROUTER_EMBEDDING_API_KEY=ollama
```

The agent embedding model must also exist on that endpoint. If embeddings are not configured, chat
may still answer general questions, but document-based answers will not work correctly after indexing
fails.

## Validation

After changing provider settings, rebuild and open the agent's `Проверка` tab. It should confirm:

- LLM key is configured;
- embeddings key is configured, if knowledge indexing is needed;
- Qdrant is reachable;
- at least one knowledge source is indexed.

Also test a real widget message. Some compatible endpoints differ in streaming or tool-call support;
EchoSupport already falls back when a provider does not support `stream_options`, but models with no
tool-call support may not perform booking actions reliably.
