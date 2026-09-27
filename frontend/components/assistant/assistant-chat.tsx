"use client";

import { AlertCircle, BookOpen, Leaf, Loader2, Mic, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  askAssistant,
  getAssistantStatus,
  type AssistantSource,
  type AssistantStatus,
} from "@/lib/api";
import { useSpeechRecognition } from "@/lib/speech";
import { cn } from "@/lib/utils";

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: AssistantSource[];
  refused?: boolean;
};

/**
 * Farming assistant chat.
 *
 * Every assistant turn renders its sources, because the whole premise of this
 * screen is that the answer comes from a curated knowledge base rather than from
 * the model's imagination. A refusal is styled as its own state, not as a normal
 * answer — pretending to have answered would be worse than admitting the gap.
 */
/**
 * Assistant chrome, per language.
 *
 * The *answer* language is decided by the backend from the question itself — a
 * farmer can type Hindi at any time without touching the toggle. This only
 * controls the app's own wording, and exists so a farmer who cannot read English
 * can discover that Hindi is supported at all. Starter chips are the main way
 * that happens.
 */
const COPY = {
  en: {
    languageLabel: "Language",
    tryAsking: "Try asking",
    placeholder: "Ask about your crop…",
    yourQuestion: "Your question",
    send: "Send question",
    listening: "Listening…",
    listenLabel: "Speak your question",
    stopListening: "Stop listening",
    thinking: "Looking through the knowledge base…",
    unavailable:
      "The assistant is not available right now. Please try again later, or ask your local KVK.",
    footnote:
      "Answers come only from a reviewed knowledge base, and the sources are always shown. The assistant will say so when it does not know.",
  },
  hi: {
    languageLabel: "भाषा",
    tryAsking: "यह पूछकर देखें",
    placeholder: "अपनी फसल के बारे में पूछें…",
    yourQuestion: "आपका सवाल",
    send: "सवाल भेजें",
    listening: "सुन रहा हूँ…",
    listenLabel: "बोलकर पूछें",
    stopListening: "सुनना बंद करें",
    thinking: "जानकारी खोजी जा रही है…",
    unavailable:
      "सहायक अभी उपलब्ध नहीं है। कृपया बाद में कोशिश करें, या अपने स्थानीय KVK से पूछें।",
    footnote:
      "जवाब सिर्फ़ जाँची हुई जानकारी से दिए जाते हैं, और स्रोत हमेशा दिखाए जाते हैं। जानकारी न होने पर सहायक साफ़ बता देगा।",
  },
} as const;

type AssistantLanguage = keyof typeof COPY;

export function AssistantChat({
  diagnosisId,
  contextLabel,
}: {
  diagnosisId?: string;
  contextLabel?: string;
}) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [language, setLanguage] = useState<AssistantLanguage>("en");
  const endRef = useRef<HTMLDivElement>(null);

  // Voice input (Web Speech API). The recognition locale follows the app's own
  // language toggle; the assistant answers in the language of the question
  // either way, so voice feeds straight into a path that already works.
  const speech = useSpeechRecognition({
    lang: language === "hi" ? "hi-IN" : "en-IN",
    copyLang: language,
    onFinal: (transcript) => {
      // Speak-and-send: a farmer taps the mic once and gets an answer. If a
      // request is already in flight, park the words in the composer instead
      // so nothing is lost.
      if (busy) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      } else {
        void send(transcript);
      }
    },
  });

  useEffect(() => {
    getAssistantStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setError(null);
    setBusy(true);
    setInput("");
    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: trimmed, sources: [] },
    ]);

    try {
      const response = await askAssistant(trimmed, {
        diagnosisId,
        conversationId,
      });
      setConversationId(response.conversation_id);
      setTurns((prev) => [
        ...prev,
        {
          id: response.message_id || `a-${Date.now()}`,
          role: "assistant",
          content: response.answer,
          sources: response.sources,
          refused: response.refused,
        },
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "I couldn't answer that right now. Please try again.",
      );
      // Drop the optimistic user turn so the transcript matches what was stored.
      setTurns((prev) => prev.slice(0, -1));
      setInput(trimmed);
    } finally {
      setBusy(false);
    }
  }

  const copy = COPY[language];
  // Both sets arrive with the status, so switching is instant — no refetch on a
  // connection that may be slow.
  const suggestions =
    language === "hi"
      ? (status?.suggested_questions_hi ?? [])
      : (status?.suggested_questions ?? []);
  const unavailable = status !== null && !status.available;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* ---- Language ----
          Always visible, and deliberately not hidden behind a menu: the whole
          point is that a farmer who cannot read English discovers Hindi exists.
          Switching only changes the app's own wording — the answer language
          follows whatever script the farmer types, toggle or not. */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted text-sm">{copy.languageLabel}</span>
        <div
          role="group"
          aria-label={copy.languageLabel}
          className="glass flex gap-1 rounded-full p-1"
        >
          {(["en", "hi"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLanguage(code)}
              aria-pressed={language === code}
              className={cn(
                "min-h-tap min-w-tap rounded-full px-4 text-sm font-semibold transition-colors",
                language === code ? "bg-accent text-white" : "text-muted hover:text-ink",
              )}
            >
              {code === "en" ? "English" : "हिंदी"}
            </button>
          ))}
        </div>
      </div>

      {contextLabel && (
        <p className="rounded-card bg-primary-soft text-primary flex items-start gap-2 p-3 text-base">
          <Leaf className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>
            Answering about your recent result: <strong>{contextLabel}</strong>
          </span>
        </p>
      )}

      {unavailable && (
        <p
          role="alert"
          className="rounded-card border-danger-border bg-danger-bg text-danger flex items-start gap-2 border p-3 text-base"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{copy.unavailable}</span>
        </p>
      )}

      {/* ---- Transcript ---- */}
      {turns.length > 0 && (
        <ul className="flex flex-col gap-4" data-testid="transcript">
          {turns.map((turn) => (
            <li key={turn.id} data-testid="turn" data-role={turn.role}>
              {turn.role === "user" ? (
                <div className="flex items-start justify-end gap-2">
                  <p className="rounded-card bg-accent max-w-[85%] px-4 py-3 text-base text-white">
                    {turn.content}
                  </p>
                  <span className="bg-primary-soft mt-1 flex size-7 shrink-0 items-center justify-center rounded-full">
                    <User className="text-primary size-4" aria-hidden="true" />
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <span className="bg-natural-bg mt-1 flex size-7 shrink-0 items-center justify-center rounded-full">
                    <Leaf className="text-natural-text size-4" aria-hidden="true" />
                  </span>
                  <div
                    className={cn(
                      "rounded-card flex max-w-[88%] flex-col gap-3 border p-4",
                      turn.refused ? "border-border bg-surface" : "glass shadow-card",
                    )}
                  >
                    <div className="flex flex-col gap-2 text-base leading-relaxed whitespace-pre-wrap">
                      {turn.content}
                    </div>

                    {turn.sources.length > 0 && (
                      <details className="border-border border-t pt-3">
                        <summary className="text-primary flex cursor-pointer items-center gap-1.5 text-sm font-semibold">
                          <BookOpen className="size-4" aria-hidden="true" />
                          Where this came from ({turn.sources.length})
                        </summary>
                        <ul className="mt-2 flex flex-col gap-2">
                          {turn.sources.map((source) => (
                            <li
                              key={source.index}
                              className="rounded-card bg-surface p-3 text-sm"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">
                                  [{source.index}] {source.source}
                                </span>
                                <span className="text-muted shrink-0">
                                  {Math.round(source.score * 100)}% match
                                </span>
                              </div>
                              <p className="text-muted mt-1">{source.excerpt}</p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <p className="text-muted flex items-center gap-2 text-base">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {copy.thinking}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-card border-danger-border bg-danger-bg text-danger flex items-start gap-2 border p-3 text-base"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <div ref={endRef} />

      {/* ---- Suggested questions ---- */}
      {turns.length === 0 && suggestions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted text-sm font-semibold tracking-wide uppercase">
            {copy.tryAsking}
          </h2>
          <ul className="flex flex-col gap-2">
            {suggestions.slice(0, 4).map((question) => (
              <li key={question}>
                <button
                  type="button"
                  onClick={() => send(question)}
                  disabled={busy || unavailable}
                  className="rounded-card glass shadow-card min-h-tap w-full px-4 py-3 text-left text-base disabled:opacity-50"
                >
                  {question}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Voice ----
          Live caption while the mic is open, so a farmer sees the app has
          heard them before anything is sent. The mic button itself renders
          only on browsers that actually support speech recognition. */}
      {speech.listening && (
        <p
          role="status"
          aria-live="polite"
          className="text-danger flex items-center gap-2 px-2 text-sm font-semibold"
        >
          <Mic className="size-4 shrink-0 animate-pulse" aria-hidden="true" />
          <span className="shrink-0">{copy.listening}</span>
          {speech.interim && (
            <span className="text-muted min-w-0 flex-1 truncate font-normal">
              “{speech.interim}”
            </span>
          )}
        </p>
      )}

      {speech.errorText && (
        <p
          role="alert"
          className="rounded-card border-danger-border bg-danger-bg text-danger flex items-start gap-2 border p-3 text-base"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{speech.errorText}</span>
        </p>
      )}

      {/* ---- Composer ---- */}
      <form
        className="bg-surface/90 sticky bottom-[var(--app-nav-height)] -mx-2 flex items-end gap-2 rounded-2xl px-2 py-2 backdrop-blur-xl sm:bottom-4"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <label className="sr-only" htmlFor="assistant-input">
          {copy.yourQuestion}
        </label>
        <textarea
          id="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder={copy.placeholder}
          disabled={busy || unavailable}
          className="input max-h-32 flex-1"
        />
        {speech.supported && (
          <button
            type="button"
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            disabled={busy || unavailable}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? copy.stopListening : copy.listenLabel}
            data-testid="mic-button"
            className={cn(
              "min-h-tap min-w-tap rounded-card flex items-center justify-center px-4 transition-colors",
              speech.listening
                ? "bg-danger animate-pulse text-white"
                : "glass text-ink hover:text-primary",
            )}
          >
            <Mic className="size-5" aria-hidden="true" />
          </button>
        )}
        <button
          type="submit"
          disabled={busy || unavailable || !input.trim()}
          aria-label={copy.send}
          className="min-h-tap min-w-tap rounded-card bg-accent flex items-center justify-center px-4 font-semibold text-white disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-5" aria-hidden="true" />
          )}
        </button>
      </form>

      <p className="text-muted text-sm">{copy.footnote}</p>
    </div>
  );
}
