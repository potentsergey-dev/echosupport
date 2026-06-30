import { env } from '../../config/env.js';

export interface TranscribeResult {
  text: string;
  language: string;
  durationMs: number;
}

interface DeepgramResponse {
  metadata?: {
    duration?: number;
  };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        languages?: string[];
      }>;
      detected_language?: string;
    }>;
  };
}

/**
 * Transcribes audio using the Deepgram Nova-2 model.
 * Returns the transcript text, detected language, and duration in ms.
 */
export async function transcribe(
  audioBuffer: Buffer,
  mimeType: string,
  apiKey?: string,
): Promise<TranscribeResult> {
  const key = apiKey ?? env.DEEPGRAM_API_KEY;
  if (!key) {
    throw new Error('Deepgram API key is not configured');
  }

  const url =
    'https://api.deepgram.com/v1/listen?model=nova-2&detect_language=true&smart_format=true';

  // Slice the backing ArrayBuffer to the exact byte range of audioBuffer.
  // Buffer.buffer may reference a shared pool, and undici's BodyInit requires ArrayBuffer.
  const body = audioBuffer.buffer.slice(
    audioBuffer.byteOffset,
    audioBuffer.byteOffset + audioBuffer.byteLength,
  ) as ArrayBuffer;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${key}`,
      'Content-Type': mimeType,
    },
    body,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Deepgram API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as DeepgramResponse;

  const channel = data.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];
  const text = alternative?.transcript ?? '';
  const language = channel?.detected_language ?? alternative?.languages?.[0] ?? 'unknown';
  const durationMs = Math.round((data.metadata?.duration ?? 0) * 1000);

  return { text, language, durationMs };
}
