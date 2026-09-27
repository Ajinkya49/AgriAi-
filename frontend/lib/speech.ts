"use client";

/**
 * Voice input for the farming audience.
 *
 * Typing Devanagari on a budget Android keyboard is slow and error-prone, so the
 * brief asks for voice above the keyboard. This wraps the browser's built-in Web
 * Speech API (`webkitSpeechRecognition`) — no transcription service, no API key.
 * It works in Chrome/Edge and Chrome on Android, which is what this audience
 * actually uses; unsupported browsers simply don't render the mic button.
 *
 * Language handling: `en-IN` (Indian English) and `hi-IN` (Hindi). The caller
 * picks the locale from the app's own language toggle; the assistant already
 * answers in the language of the question, so voice feeds straight into a path
 * that works.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// ---- Minimal typings for the Web Speech API --------------------------------
// TypeScript's DOM lib doesn't include SpeechRecognition yet, and one hook does
// not justify a @types package, so the small surface we use is declared here.

type SpeechAlternativeLike = { transcript: string };

type SpeechResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternativeLike;
};

type SpeechResultListLike = {
  length: number;
  [index: number]: SpeechResultLike;
};

type SpeechEventLike = {
  resultIndex: number;
  results: SpeechResultListLike;
};

type SpeechErrorEventLike = { error: string };

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type SpeechWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };

// ---- Public surface ----------------------------------------------------------

export type SpeechErrorCode =
  "not-allowed" | "no-speech" | "audio-capture" | "network" | "unknown";

export type SpeechCopyLang = "en" | "hi";

/**
 * Farmer-facing error copy, bilingual. Lives next to the hook so callers render
 * one string without duplicating the wording.
 */
const ERROR_COPY: Record<SpeechErrorCode, { en: string; hi: string }> = {
  "not-allowed": {
    en: "Microphone permission was blocked. Allow it in your browser settings and try again.",
    hi: "माइक की अनुमति नहीं मिली। कृपया ब्राउज़र सेटिंग में अनुमति दें और फिर कोशिश करें।",
  },
  "no-speech": {
    en: "I didn't hear anything. Tap the mic and speak again.",
    hi: "कुछ सुनाई नहीं दिया। माइक दबाकर फिर बोलें।",
  },
  "audio-capture": {
    en: "No microphone was found on this device.",
    hi: "इस डिवाइस पर कोई माइक नहीं मिला।",
  },
  network: {
    en: "Voice input needs a working internet connection. Please try again.",
    hi: "आवाज़ से पूछने के लिए इंटरनेट ज़रूरी है। कृपया फिर कोशिश करें।",
  },
  unknown: {
    en: "Voice input didn't work. Please type your question instead.",
    hi: "आवाज़ से पूछना काम नहीं कर सका। कृपया अपना सवाल लिखें।",
  },
};

export function speechErrorCopy(code: SpeechErrorCode, lang: SpeechCopyLang): string {
  return ERROR_COPY[code][lang];
}

// ---- Browser capability -----------------------------------------------------
// Read once per call from the live window; module-level so the hook subscribes
// without re-creating closures every render.

function subscribeNoop(onStoreChange: () => void): () => void {
  // Browser speech support never changes at runtime, so there is nothing to
  // subscribe to — React just wants a stable subscribe function.
  void onStoreChange;
  return () => {};
}

function getSpeechSupportedSnapshot(): boolean {
  const w = window as SpeechWindow;
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

function getSpeechSupportedServerSnapshot(): boolean {
  // No window on the server — the mic is hidden during SSR and after hydration
  // swaps in the real answer.
  return false;
}

// ---- The hook ----------------------------------------------------------------

export function useSpeechRecognition({
  lang = "en-IN",
  copyLang = "en",
  onFinal,
}: {
  /** BCP-47 locale for recognition. */
  lang?: "en-IN" | "hi-IN";
  /** Language used for the localized error text. */
  copyLang?: SpeechCopyLang;
  /** Called once per recognized final phrase. */
  onFinal: (transcript: string) => void;
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  const langRef = useRef(lang);

  // Keep the callbacks refs point at fresh without reading/writing them during
  // render (React Compiler forbids that). They are only ever consumed inside
  // event handlers and recognizer callbacks, never to compute UI.
  useEffect(() => {
    onFinalRef.current = onFinal;
    langRef.current = lang;
  });

  // Browser capability. `useSyncExternalStore` is the SSR-safe way to read a
  // browser-only value during render: the server snapshot is `false`, and React
  // re-renders once after hydration with the real answer — so the mic button
  // simply appears on supporting browsers, with no hydration mismatch.
  const supported = useSyncExternalStore(
    subscribeNoop,
    getSpeechSupportedSnapshot,
    getSpeechSupportedServerSnapshot,
  );

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [errorCode, setErrorState] = useState<SpeechErrorCode | null>(null);

  // Build (or rebuild) the recognizer on demand so `lang` is always current.
  const ensureRecognition = useCallback((): SpeechRecognitionLike | null => {
    if (recognitionRef.current) return recognitionRef.current;
    const w = window as SpeechWindow;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return null;

    const rec = new Ctor();
    rec.lang = langRef.current;
    rec.continuous = false; // one phrase per tap — matches a farmer's question
    rec.interimResults = true; // live transcript while speaking
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const trimmed = transcript.trim();
          if (trimmed) onFinalRef.current(trimmed);
        } else {
          interimText += transcript;
        }
      }
      setInterim(interimText);
    };

    rec.onerror = (event) => {
      // An abort is the user cancelling — not worth an error message.
      if (event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setErrorState("not-allowed");
      } else if (event.error === "no-speech") {
        setErrorState("no-speech");
      } else if (event.error === "audio-capture") {
        setErrorState("audio-capture");
      } else if (event.error === "network") {
        setErrorState("network");
      } else {
        setErrorState("unknown");
      }
    };

    rec.onend = () => {
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = rec;
    return rec;
  }, []);

  const start = useCallback(() => {
    setErrorState(null);
    const rec = ensureRecognition();
    if (!rec) return;
    // Re-read lang on every start so the toggle is honoured mid-session.
    rec.lang = langRef.current;
    try {
      rec.start();
      setListening(true);
      setInterim("");
    } catch {
      // start() throws InvalidStateError if it is already running; ignore.
    }
  }, [ensureRecognition]);

  const stop = useCallback(() => {
    // Graceful stop: any final phrase still in flight is delivered.
    recognitionRef.current?.stop();
  }, []);

  const dismissError = useCallback(() => setErrorState(null), []);

  // Never leave the mic open across navigation or unmount.
  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  return {
    /** null until mounted; false = browser has no speech API (hide the mic). */
    supported,
    listening,
    interim,
    errorCode,
    errorText: errorCode ? speechErrorCopy(errorCode, copyLang) : null,
    start,
    stop,
    dismissError,
  };
}
