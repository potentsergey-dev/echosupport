export function TypingIndicator({ agentName }: { agentName: string }) {
  return (
    <div class="flex items-end gap-2 px-4 py-2">
      <div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">
        {agentName[0]?.toUpperCase()}
      </div>
      <div class="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            class="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400"
            style={{ animation: `typing-dot 1s ease-in-out ${delay}ms infinite` }}
          />
        ))}
      </div>
    </div>
  );
}
