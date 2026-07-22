import { useRef, useState } from 'preact/hooks';
import { isRecording, inputText } from '../signals';
import { sendAudio } from '../api';
import { t } from '../i18n';

export function MicButton() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [error, setError] = useState('');

  async function startRecording() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        try {
          const text = await sendAudio(blob, mimeType);
          if (text) {
            inputText.value = inputText.value ? `${inputText.value} ${text}` : text;
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : t('transcriptionFailed'));
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      isRecording.value = true;
    } catch {
      setError(t('microphoneDenied'));
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    isRecording.value = false;
  }

  function handleClick() {
    if (isRecording.value) {
      stopRecording();
    } else {
      void startRecording();
    }
  }

  return (
    <div class="relative">
      <button
        onClick={handleClick}
        title={isRecording.value ? t('stopRecording') : t('voiceInput')}
        class={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
          isRecording.value
            ? 'bg-red-500 text-white animate-pulse'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zm-1 3a1 1 0 012 0v8a1 1 0 01-2 0V4zm7.25 5A7.25 7.25 0 0111.03 15.93V18H9v2h6v-2h-2.03V15.93A7.25 7.25 0 0020.25 9H18.2a5.2 5.2 0 01-10.4 0H5.75A7.25 7.25 0 0012 16.25 7.25 7.25 0 0019.25 9h-1z" />
        </svg>
      </button>
      {error && (
        <div class="absolute bottom-10 right-0 w-48 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700 shadow">
          {error}
        </div>
      )}
    </div>
  );
}
