import OpenAI from 'openai';
import { toFile } from 'openai';
import type { TranscribeResult } from './deepgram.js';

/**
 * Transcribes audio using OpenAI Whisper (whisper-1 model).
 * Used as a fallback when agent.sttProvider = 'WHISPER'.
 */
export async function transcribe(
  audioBuffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<TranscribeResult> {
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured');
  }

  const client = new OpenAI({ apiKey });

  // Map mimeType to a file extension Whisper accepts
  const ext = mimeTypeToExt(mimeType);

  const file = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType });

  const started = Date.now();
  const transcription = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'verbose_json',
  });

  const durationMs =
    typeof transcription.duration === 'number'
      ? Math.round(transcription.duration * 1000)
      : Date.now() - started;

  return {
    text: transcription.text ?? '',
    language: transcription.language ?? 'unknown',
    durationMs,
  };
}

function mimeTypeToExt(mimeType: string): string {
  // Normalize: strip codec params (e.g. 'audio/webm;codecs=opus' → 'audio/webm')
  const base = mimeType.split(';')[0]!.trim();
  switch (base) {
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'mp4';
    case 'audio/wav':
    case 'audio/wave':
      return 'wav';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    default:
      return 'webm';
  }
}
