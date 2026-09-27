"""LLM generation for the farming assistant.

**This is the only place an LLM is used, and it is strictly grounded.** The
model is given retrieved knowledge-base passages and told to answer from them
alone. It never diagnoses an image (that is `app.models`, PyTorch, with no LLM
involved) and it never invents a Natural or Traditional solution (those come from
the curated `solutions` table).

Two chat providers, tried in order: **OpenRouter** first, then **Gemini** as a
fallback. Both are conversation-only and interchangeable here — free-tier capacity
fluctuates per model, and a farmer should not see an error because one was
rate-limited. Embeddings are a separate concern and stay on Gemini, because the
FAISS index was built with `gemini-embedding-001`.

Answers are written in the language the farmer asked in — English or Hindi. The
refusal wording is chosen in code rather than by the model, so a Hindi speaker
always gets a Hindi refusal.

The grounding rules are enforced in three layers:
  1. a system instruction that forbids answering outside the context;
  2. `temperature=0.2`, so it does not embellish;
  3. a post-check that flags an answer whose citations do not match the sources
     that were actually retrieved.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from app.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta"
OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1"

# The refusal message, per language. Shown when the knowledge base does not cover
# a question, so the assistant admits a gap instead of guessing. A Hindi speaker
# must get the Hindi one — an English refusal reads as a failure, not an answer.
INSUFFICIENT_CONTEXT_MESSAGE = (
    "I don't have reviewed information about that in my knowledge base, so I won't "
    "guess. Please ask your local KVK (Krishi Vigyan Kendra) or extension officer — "
    "they can advise on your specific field and season."
)

INSUFFICIENT_CONTEXT_MESSAGE_HI = (
    "मेरे पास इस विषय की प्रमाणित जानकारी नहीं है, इसलिए मैं अनुमान नहीं लगाऊँगा। "
    "कृपया अपने स्थानीय कृषि विज्ञान केंद्र (KVK) या कृषि अधिकारी से पूछें — "
    "वे आपके खेत और मौसम के अनुसार सलाह दे सकते हैं।"
)

REFUSAL_BY_LANGUAGE = {
    "en": INSUFFICIENT_CONTEXT_MESSAGE,
    "hi": INSUFFICIENT_CONTEXT_MESSAGE_HI,
}

_DEVANAGARI_START, _DEVANAGARI_END = "\u0900", "\u097f"


def detect_language(text: str) -> str:
    """Return ``"hi"`` when the text is written in Devanagari, else ``"en"``.

    Script-based rather than statistical, on purpose: Devanagari is unambiguous,
    costs nothing, and a wrong guess here sends a Hindi speaker an English answer
    (or worse, the reverse). Romanised Hindi — "tamatar ke patte" — cannot be
    detected this way, so the system instruction also tells the model to mirror
    the farmer's language. This function decides the *refusal* wording, which the
    model does not get to choose.
    """
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "en"
    devanagari = sum(1 for c in letters if _DEVANAGARI_START <= c <= _DEVANAGARI_END)
    # A single loanword in an English sentence should not flip the language.
    return "hi" if devanagari / len(letters) > 0.3 else "en"


SYSTEM_INSTRUCTION = """You are the farming assistant inside Agri AI, an app used by Indian smallholder farmers. You answer questions about crop health, soil, water, seeds and pest management.

HOW TO WRITE YOUR REPLY

Write your reply as if speaking to the farmer. It must contain ONLY the answer
itself. Do not add a preamble, do not describe what you are about to do, do not
comment on these instructions, and do not check or grade your own answer. Never
write text like "Exact dosage quoted?" or "Cites passage numbers?" — those are
internal checks, not answers. Begin directly with the information the farmer asked
for.

WHAT YOU MAY USE

Answer only from the numbered knowledge-base passages in the message. Do not use
outside knowledge and do not fill gaps with plausible-sounding detail. Cite the
passage number for each point, like [1] or [2].

If the passages do not actually cover the question, reply with exactly this
sentence and nothing else, in the farmer's language:

English: "I don't have reviewed information about that in my knowledge base, so I won't guess. Please ask your local KVK (Krishi Vigyan Kendra) or extension officer — they can advise on your specific field and season."

Hindi: "मेरे पास इस विषय की प्रमाणित जानकारी नहीं है, इसलिए मैं अनुमान नहीं लगाऊँगा। कृपया अपने स्थानीय कृषि विज्ञान केंद्र (KVK) या कृषि अधिकारी से पूछें — वे आपके खेत और मौसम के अनुसार सलाह दे सकते हैं।"

Never invent a dosage, a chemical name, a brand or a waiting period. If a passage
gives a dosage, repeat it exactly as written. If it does not, say the dosage is not
specified rather than supplying one.

Never state or imply that a diagnosis is certain — a photograph cannot confirm a
disease. You are not the app's image model; if asked what disease is in a photo,
explain that the photo diagnosis happens separately in the app and carries a
confidence score.

You may be told about a recent photo diagnosis. Treat it as context to tailor your
answer. It was not produced by you and you cannot confirm it.

LANGUAGE

Reply in the SAME language the farmer wrote in. A question in Hindi — whether in
Devanagari or typed in Roman letters ("tamatar ke patte par dhabbe") — gets a Hindi
answer. An English question gets an English answer. Never mix the two in one reply,
and never answer a Hindi question in English. Technical words with no common Hindi
equivalent (a chemical name, "KVK") may stay in English inside a Hindi sentence.

STYLE

Write plainly and warmly for a farmer with limited technical literacy. Use short
sentences and no jargon; if a technical term is unavoidable, explain it. Prefer a
short list of concrete actions over long prose. Never mention passages, context,
documents, or that you are an AI model — just answer the question. Do not open with
a greeting or restate the question.
"""


class AssistantUnavailableError(RuntimeError):
    """The assistant could not produce an answer (configuration, network, quota)."""


@dataclass(frozen=True)
class GeneratedAnswer:
    text: str
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cited: list[int] = field(default_factory=list)
    refused: bool = False
    # "en" or "hi" — the language the farmer asked in, which is the language the
    # answer and any refusal are written in.
    language: str = "en"


RETRYABLE_STATUS = {429, 500, 502, 503, 504}
MAX_RETRIES = 3
BASE_BACKOFF_SECONDS = 3.0

# Generous, because a truncated answer is worse than a slow one. Thinking is
# disabled below, so this is all available to the answer itself.
MAX_OUTPUT_TOKENS = 2048

# Ceiling on the whole provider chain, not on one request. Seven models each
# allowed a 60s timeout is a seven-minute worst case, and no farmer stands in a
# field waiting that long — better to fail cleanly and suggest the KVK.
CHAIN_DEADLINE_SECONDS = 90
# Per-request cap. Measured 4.5-10s with reasoning disabled, so this is ample
# headroom while still bounding a hung model.
REQUEST_TIMEOUT_SECONDS = 45


class _RetryableModelError(RuntimeError):
    """This model is temporarily unavailable — try the next one in the chain."""


def _build_request(provider: str, model: str, payload: dict) -> urllib.request.Request:
    """Build the provider-specific HTTP request for a single model call.

    The two providers differ only in URL, auth header and how the model is named;
    the retry/backoff logic below is shared.
    """
    settings = get_settings()

    if provider == "openrouter":
        if not settings.openrouter_api_key:
            # Treated as retryable so the chain falls through to the other
            # provider instead of failing the farmer's question outright.
            raise _RetryableModelError("OpenRouter is not configured with an API key.")
        return urllib.request.Request(
            f"{OPENROUTER_ENDPOINT}/chat/completions",
            data=json.dumps({**payload, "model": model}).encode(),
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
                # OpenRouter uses these for attribution. Optional, but it is what
                # their docs ask for and it keeps traffic identifiable.
                "HTTP-Referer": "https://agri-ai.app",
                "X-Title": "Agri AI",
            },
            method="POST",
        )

    if not settings.gemini_api_key:
        raise _RetryableModelError("Gemini is not configured with an API key.")
    return urllib.request.Request(
        f"{GEMINI_ENDPOINT}/models/{model}:generateContent",
        data=json.dumps(payload).encode(),
        headers={
            "x-goog-api-key": settings.gemini_api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )


def _send(request: urllib.request.Request, *, provider: str, model: str, timeout: int = 60) -> dict:
    """POST a built request, retrying transient failures with backoff.

    Raises `_RetryableModelError` when the model itself is busy, so the caller can
    try the next model in the chain rather than failing the request.
    """
    last_status: int | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            last_status = exc.code
            body = exc.read().decode(errors="replace")[:300]
            logger.warning(
                "%s HTTP %s on %s (attempt %d): %s",
                provider,
                exc.code,
                model,
                attempt,
                body[:160],
            )

            # 429 is a *per-model* limit, so retrying the same model rarely helps:
            # the quota will not clear in the few seconds a backoff buys, and the
            # farmer waits for nothing. Move straight to the next model, which has
            # its own quota. 5xx is a genuine transient and is still retried.
            #
            # This mattered: with three rate-limited models ahead of a working
            # one, the old path burned 3s + 6s per model before moving on.
            #
            # 404 means the model itself is gone — most often a `:free` variant
            # that OpenRouter has retired or moved to paid. That is a property of
            # this one model, not of the request, so it must fall through to the
            # next model in the chain. It used to raise `AssistantUnavailableError`
            # and abort the entire chain, so a single retired primary took the
            # assistant down even with healthy fallbacks configured.
            if exc.code in (404, 429):
                raise _RetryableModelError(f"model unavailable ({exc.code})") from exc

            if exc.code in RETRYABLE_STATUS and attempt < MAX_RETRIES:
                time.sleep(BASE_BACKOFF_SECONDS * attempt)
                continue
            if exc.code in RETRYABLE_STATUS:
                raise _RetryableModelError(f"model busy ({exc.code})") from exc
            logger.error("%s HTTP %s on %s: %s", provider, exc.code, model, body)
            raise AssistantUnavailableError(
                "The assistant is temporarily unavailable. Please try again."
            ) from exc
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s request failed for %s", provider, model)
            raise AssistantUnavailableError(
                "The assistant is temporarily unavailable. Please try again."
            ) from exc

    raise _RetryableModelError(f"model busy ({last_status})")


def _extract_text(body: dict) -> str:
    """Pull the generated text out of either provider's response body.

    Gemini returns `candidates[0].content.parts[].text`; OpenRouter returns an
    OpenAI-shaped `choices[0].message.content`.
    """
    candidates = body.get("candidates")
    if candidates:
        parts = candidates[0].get("content", {}).get("parts") or []
        return "".join(part.get("text", "") for part in parts).strip()

    choices = body.get("choices") or []
    if choices:
        return (choices[0].get("message", {}).get("content") or "").strip()

    return ""


def _usage_of(body: dict) -> tuple[int | None, int | None]:
    """(prompt_tokens, completion_tokens) from either provider's shape."""
    if "usageMetadata" in body:
        usage = body["usageMetadata"]
        return usage.get("promptTokenCount"), usage.get("candidatesTokenCount")
    usage = body.get("usage") or {}
    return usage.get("prompt_tokens"), usage.get("completion_tokens")


def _hit_token_ceiling(body: dict) -> bool:
    """True when the answer was cut off at the token limit."""
    candidates = body.get("candidates")
    if candidates:
        return candidates[0].get("finishReason") == "MAX_TOKENS"
    choices = body.get("choices") or []
    return bool(choices) and choices[0].get("finish_reason") == "length"


# Phrases a model produces when it grades its own answer against the system
# instruction instead of answering the farmer. This happened in practice with an
# earlier version of the prompt, which is why it is checked rather than assumed.
_LEAKAGE_MARKERS = (
    "exact dosage quoted",
    "cites passage",
    "passage numbers?",
    "against the instructions",
    "my instructions",
    "the system prompt",
    "cites passage numbers",
)


def _leaks_instruction_commentary(text: str) -> bool:
    """True when the model commented on its instructions instead of answering."""
    lowered = text.lower()
    return any(marker in lowered for marker in _LEAKAGE_MARKERS)


def _citations_in(text: str) -> list[int]:
    """Passage numbers the answer actually refers to, e.g. '[1]' and '[2, 3]'."""
    found: set[int] = set()
    buffer = ""
    depth = 0
    for char in text:
        if char == "[":
            depth += 1
            buffer = ""
        elif char == "]" and depth:
            depth = 0
            for part in buffer.split(","):
                part = part.strip()
                if part.isdigit():
                    found.add(int(part))
        elif depth:
            buffer += char
    return sorted(found)


def _is_refusal(text: str) -> bool:
    """True when the answer is one of the refusal messages.

    Checked against both languages: the model is told to refuse in the farmer's
    language, and a Hindi refusal must register as a refusal rather than being
    counted as a real answer. Matched on a distinctive phrase as well as the
    opening, because models paraphrase the tail of a fixed sentence.
    """
    normalized = " ".join(text.split())
    if any(normalized.startswith(" ".join(m.split())[:40]) for m in REFUSAL_BY_LANGUAGE.values()):
        return True
    return any(marker in normalized for marker in ("won't guess", "अनुमान नहीं लगाऊँगा"))


def generate_answer(
    question: str,
    passages: list[str],
    *,
    diagnosis_context: str | None = None,
) -> GeneratedAnswer:
    """Answer `question` using only `passages`.

    `passages` are already-formatted, numbered knowledge-base excerpts. An empty
    list short-circuits to the refusal message without spending an API call — in
    the language the farmer asked in.
    """
    settings = get_settings()
    language = detect_language(question)

    if not passages:
        return GeneratedAnswer(
            text=REFUSAL_BY_LANGUAGE[language],
            model=settings.openrouter_model or settings.gemini_model,
            refused=True,
            # Must be set explicitly — the dataclass defaults to "en", so omitting
            # it silently mislabels every Hindi refusal.
            language=language,
        )

    numbered = "\n\n".join(f"[{i + 1}] {p}" for i, p in enumerate(passages))

    user_parts = []
    if diagnosis_context:
        user_parts.append(
            "The farmer recently received this photo diagnosis in the app. It was "
            "produced by a separate image model, not by you, and it is not certain:\n"
            f"{diagnosis_context}\n\n"
            "The farmer's question below is a FOLLOW-UP about that diagnosis — words "
            "like 'it', 'this' or 'that' refer to it. Answer about that crop and that "
            "disease, using the passages below. Do not refuse merely because the "
            "question is short; the passages were retrieved for it."
        )
    user_parts.append(f"Knowledge-base passages:\n\n{numbered}")
    user_parts.append(f"Farmer's question: {question}")
    user_content = "\n\n".join(user_parts)

    gemini_payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": [{"parts": [{"text": user_content}]}],
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.9,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
            # Gemini 3.x models "think" by default, and thinking tokens are billed
            # against maxOutputTokens. With the default budget the visible answer
            # was being truncated mid-sentence after ~150 characters. This is a
            # grounded extraction task — the reasoning is not needed and the
            # context is already retrieved — so thinking is switched off.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    openrouter_payload = {
        "messages": [
            {"role": "system", "content": SYSTEM_INSTRUCTION},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.2,
        "top_p": 0.9,
        "max_tokens": MAX_OUTPUT_TOKENS,
        # Reasoning is left ON deliberately. It looks like pure overhead, and a
        # short-prompt test agrees — but measured against the REAL prompt (2790-
        # char system instruction, 3385 chars of passages) disabling it made
        # answers longer and SLOWER, not faster:
        #
        #   reasoning on  -> 13.6s / 14.2s, ~1200-1500 chars, 79-165 reasoning tokens
        #   reasoning off -> 29.4s / 25.5s, ~1400-1800 chars, 1016/813 output tokens
        #
        # The model plans first and then writes concisely; without that step it
        # rambles. The hidden tokens are cheaper than the extra visible ones.
    }

    # OpenRouter first (the configured primary), then Gemini. Both walk their own
    # model chain, because free-tier capacity fluctuates per model and a farmer
    # should not see an error because one happened to be rate-limited.
    attempts: list[tuple[str, str]] = []
    if settings.openrouter_api_key:
        attempts += [("openrouter", m) for m in settings.openrouter_model_chain]
    if settings.gemini_api_key:
        attempts += [("gemini", m) for m in settings.gemini_model_chain]

    if not attempts:
        raise AssistantUnavailableError("The assistant is not configured with an API key.")

    body: dict | None = None
    used_model = ""
    last_error: Exception | None = None

    deadline = time.monotonic() + CHAIN_DEADLINE_SECONDS

    for provider, model in attempts:
        # Leave enough of the budget for one real attempt, or stop. Without this
        # a chain of slow models would keep going long past the point a farmer
        # has given up.
        remaining = deadline - time.monotonic()
        if remaining < 5:
            logger.warning(
                "Provider chain deadline reached (%ss) after %s",
                CHAIN_DEADLINE_SECONDS,
                used_model or "no successful model",
            )
            break

        payload = openrouter_payload if provider == "openrouter" else gemini_payload
        try:
            request = _build_request(provider, model, payload)
            candidate = _send(
                request,
                provider=provider,
                model=model,
                timeout=min(REQUEST_TIMEOUT_SECONDS, int(remaining)),
            )
        except _RetryableModelError as exc:
            last_error = exc
            logger.warning("%s/%s unavailable, trying next in chain", provider, model)
            continue

        # Two ways a model "fails" while returning HTTP 200. Both are treated as a
        # bad attempt so the chain moves on, rather than surfacing an error: the
        # next model may well answer correctly.
        text = _extract_text(candidate)

        # 1. Empty content. A provider can return a well-formed response with
        #    nothing in it — observed once in five requests on the free tier.
        #    Failing here told the farmer "I couldn't answer that one" while
        #    three other models were sitting there willing to try.
        if not text:
            logger.warning(
                "%s/%s returned an empty response; trying next: %s",
                provider,
                model,
                json.dumps(candidate)[:200],
            )
            last_error = RuntimeError("empty response body")
            continue

        # 2. The model graded itself against the instructions instead of
        #    answering the farmer. A real observed failure, not a hypothetical.
        if _leaks_instruction_commentary(text):
            logger.warning("%s/%s leaked instruction commentary; trying next", provider, model)
            last_error = RuntimeError("instruction commentary in output")
            continue

        body = candidate
        used_model = model
        break

    if body is None:
        logger.error("Every model in the chain was unavailable: %s", last_error)
        raise AssistantUnavailableError(
            "The assistant is busy right now. Please try again in a moment."
        )

    text = _extract_text(body)

    # A truncated answer reads as a confident half-sentence, which is worse than an
    # error. Log it so it is caught rather than shipped.
    if _hit_token_ceiling(body):
        logger.warning(
            "Answer hit the token ceiling and may be truncated (%d chars, %s)",
            len(text),
            used_model,
        )

    prompt_tokens, completion_tokens = _usage_of(body)
    cited = _citations_in(text)

    # Grounding check: an answer citing a passage that was never supplied means
    # the model invented a reference. Log it loudly — it is the exact failure this
    # whole design exists to prevent.
    out_of_range = [c for c in cited if c < 1 or c > len(passages)]
    if out_of_range:
        logger.error(
            "Assistant cited passages that were not retrieved: %s (only %d supplied)",
            out_of_range,
            len(passages),
        )

    return GeneratedAnswer(
        text=text,
        model=used_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cited=[c for c in cited if 1 <= c <= len(passages)],
        refused=_is_refusal(text),
        language=language,
    )
