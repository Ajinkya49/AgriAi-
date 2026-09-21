"""Assistant LLM layer: language handling and provider plumbing.

Everything here is offline. The provider chain is tested by inspecting the
requests it *builds* rather than by calling OpenRouter or Gemini — a test suite
that needs two third-party APIs and a free-tier quota is a suite that fails for
reasons unrelated to the code.

The behaviour that matters most is language routing: a Hindi-speaking farmer must
get a Hindi answer, and a Hindi refusal when the knowledge base cannot help.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.rag.llm import (
    INSUFFICIENT_CONTEXT_MESSAGE,
    INSUFFICIENT_CONTEXT_MESSAGE_HI,
    REFUSAL_BY_LANGUAGE,
    AssistantUnavailableError,
    _build_request,
    _extract_text,
    _hit_token_ceiling,
    _is_refusal,
    _usage_of,
    detect_language,
    generate_answer,
)

# --------------------------------------------------------------------------
# Language detection
# --------------------------------------------------------------------------


def test_english_is_detected_as_english() -> None:
    assert detect_language("How do I stop late blight from spreading?") == "en"


def test_devanagari_is_detected_as_hindi() -> None:
    assert detect_language("लेट ब्लाइट को फैलने से कैसे रोकूँ?") == "hi"


def test_a_single_loanword_does_not_flip_the_language() -> None:
    """A technical term dropped into an English sentence must not switch it.

    "KVK" and chemical names have no common Hindi equivalent, so they legitimately
    appear inside English sentences.
    """
    assert detect_language("Should I ask my KVK about this?") == "en"


def test_romanised_hindi_is_not_guessed() -> None:
    """Romanised Hindi cannot be detected by script — the model mirrors it instead.

    Pinned as a test so the limitation is explicit rather than a surprise: this
    returns "en", which only decides the refusal wording. The system instruction
    handles the answer language.
    """
    assert detect_language("tamatar ke patte par dhabbe") == "en"


def test_empty_question_defaults_to_english() -> None:
    assert detect_language("") == "en"
    assert detect_language("12345 ?!") == "en"


# --------------------------------------------------------------------------
# Refusal messages
# --------------------------------------------------------------------------


def test_each_language_has_a_refusal_message() -> None:
    assert set(REFUSAL_BY_LANGUAGE) == {"en", "hi"}
    assert INSUFFICIENT_CONTEXT_MESSAGE_HI != INSUFFICIENT_CONTEXT_MESSAGE
    # The Hindi refusal must actually be in Devanagari, not English with a
    # translated label bolted on.
    assert detect_language(INSUFFICIENT_CONTEXT_MESSAGE_HI) == "hi"


@pytest.mark.parametrize("message", list(REFUSAL_BY_LANGUAGE.values()))
def test_refusals_are_recognised(message: str) -> None:
    assert _is_refusal(message) is True


def test_a_real_answer_is_not_mistaken_for_a_refusal() -> None:
    answer = (
        "Remove and destroy the infected leaves immediately, and do not compost "
        "them [1]. Improve air flow between plants."
    )
    assert _is_refusal(answer) is False


def test_empty_passages_refuse_in_the_farmers_language() -> None:
    """No retrieved context short-circuits without spending an API call."""
    english = generate_answer("How do I stop late blight?", [])
    assert english.refused is True
    assert english.language == "en"
    assert english.text == INSUFFICIENT_CONTEXT_MESSAGE

    hindi = generate_answer("लेट ब्लाइट को कैसे रोकूँ?", [])
    assert hindi.refused is True
    assert hindi.language == "hi"
    assert hindi.text == INSUFFICIENT_CONTEXT_MESSAGE_HI


# --------------------------------------------------------------------------
# Provider plumbing — response shapes differ, and both must be understood
# --------------------------------------------------------------------------


def test_gemini_response_shape_is_read() -> None:
    body = {
        "candidates": [{"content": {"parts": [{"text": "Remove the leaves [1]."}]}}],
        "usageMetadata": {"promptTokenCount": 120, "candidatesTokenCount": 40},
    }
    assert _extract_text(body) == "Remove the leaves [1]."
    assert _usage_of(body) == (120, 40)
    assert _hit_token_ceiling(body) is False


def test_openrouter_response_shape_is_read() -> None:
    body = {
        "choices": [{"message": {"content": "Remove the leaves [1]."}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 120, "completion_tokens": 40},
    }
    assert _extract_text(body) == "Remove the leaves [1]."
    assert _usage_of(body) == (120, 40)
    assert _hit_token_ceiling(body) is False


@pytest.mark.parametrize(
    "body",
    [
        {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "x"}]}}]},
        {"choices": [{"finish_reason": "length", "message": {"content": "x"}}]},
    ],
)
def test_truncation_is_detected_in_both_shapes(body: dict) -> None:
    assert _hit_token_ceiling(body) is True


def test_an_unrecognised_body_yields_no_text() -> None:
    assert _extract_text({}) == ""
    assert _usage_of({}) == (None, None)
    assert _hit_token_ceiling({}) is False


# --------------------------------------------------------------------------
# Request building
# --------------------------------------------------------------------------


def test_openrouter_request_carries_bearer_auth_and_model(monkeypatch) -> None:
    settings = Settings(openrouter_api_key="test-key", gemini_api_key="")
    monkeypatch.setattr("app.rag.llm.get_settings", lambda: settings)

    request = _build_request("openrouter", "vendor/model:free", {"messages": []})

    assert request.full_url == "https://openrouter.ai/api/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer test-key"
    # The model travels in the JSON body, not the URL.
    assert b"vendor/model:free" in request.data


def test_gemini_request_puts_the_model_in_the_path(monkeypatch) -> None:
    settings = Settings(gemini_api_key="test-key", openrouter_api_key="")
    monkeypatch.setattr("app.rag.llm.get_settings", lambda: settings)

    request = _build_request("gemini", "gemini-3.6-flash", {"contents": []})

    assert request.full_url.endswith("/models/gemini-3.6-flash:generateContent")
    assert request.get_header("X-goog-api-key") == "test-key"


@pytest.mark.parametrize(
    ("provider", "settings_kwargs"),
    [
        ("openrouter", {"gemini_api_key": "present", "openrouter_api_key": ""}),
        ("gemini", {"gemini_api_key": "", "openrouter_api_key": "present"}),
    ],
)
def test_a_provider_without_a_key_is_retryable_not_fatal(
    monkeypatch, provider: str, settings_kwargs: dict
) -> None:
    """A missing key must fall through to the other provider.

    Raising the non-retryable error here would abort the whole chain and show the
    farmer an error even though the other provider could have answered.
    """
    from app.rag.llm import _RetryableModelError

    monkeypatch.setattr("app.rag.llm.get_settings", lambda: Settings(**settings_kwargs))
    with pytest.raises(_RetryableModelError):
        _build_request(provider, "some-model", {})


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------


def test_model_chain_dedupes_and_keeps_order() -> None:
    settings = Settings(
        openrouter_model="primary/model",
        openrouter_fallback_models="backup/one, primary/model, backup/two",
    )
    assert settings.openrouter_model_chain == [
        "primary/model",
        "backup/one",
        "backup/two",
    ]


def test_gemini_chain_still_parses_space_separated_fallbacks() -> None:
    settings = Settings(gemini_model="g1", gemini_fallback_models="g2 g3")
    assert settings.gemini_model_chain == ["g1", "g2", "g3"]


@pytest.mark.parametrize(
    ("openrouter", "gemini", "expected"),
    [
        ("or-key", "", True),
        ("", "gm-key", True),
        ("or-key", "gm-key", True),
        ("", "", False),
    ],
)
def test_either_provider_is_enough_to_configure_the_assistant(
    openrouter: str, gemini: str, expected: bool
) -> None:
    settings = Settings(
        openrouter_api_key=openrouter,
        gemini_api_key=gemini,
        faiss_index_path="app/rag/index/knowledge_base.faiss",
    )
    assert settings.is_rag_configured is expected


def test_production_reports_when_neither_provider_is_set() -> None:
    settings = Settings(
        environment="production",
        openrouter_api_key="",
        gemini_api_key="",
        supabase_url="https://x.supabase.co",
        supabase_anon_key="a",
        supabase_service_role_key="s",
        database_url="postgresql://x",
        cors_origins="https://agri-ai.app",
    )
    problems = " ".join(settings.production_problems())
    assert "OPENROUTER_API_KEY" in problems and "GEMINI_API_KEY" in problems


def test_production_is_quiet_when_openrouter_is_set_and_gemini_is_not() -> None:
    """OpenRouter alone is enough for chat; Gemini is only needed for embeddings."""
    settings = Settings(
        environment="production",
        openrouter_api_key="or-key",
        gemini_api_key="",
        supabase_url="https://x.supabase.co",
        supabase_anon_key="a",
        supabase_service_role_key="s",
        database_url="postgresql://x",
        cors_origins="https://agri-ai.app",
    )
    problems = " ".join(settings.production_problems())
    assert "assistant will return 503" not in problems
    assert "cannot be rebuilt" in problems


# --------------------------------------------------------------------------
# Failure handling inside the chain
# --------------------------------------------------------------------------


def test_an_empty_response_falls_through_to_the_next_model(monkeypatch) -> None:
    """HTTP 200 with no content is a bad attempt, not the farmer's problem.

    A provider returned a well-formed response with empty content once in five
    requests on the free tier. Surfacing that as "I couldn't answer" while other
    models were available to try was the actual bug.
    """
    settings = Settings(
        openrouter_api_key="key",
        openrouter_model="first/model",
        openrouter_fallback_models="second/model",
        gemini_api_key="",
    )
    monkeypatch.setattr("app.rag.llm.get_settings", lambda: settings)

    tried: list[str] = []

    def fake_send(request, *, provider, model, timeout=60):
        tried.append(model)
        if model == "first/model":
            return {"choices": [{"message": {"content": ""}, "finish_reason": "stop"}]}
        return {
            "choices": [
                {"message": {"content": "Remove the leaves [1]."}, "finish_reason": "stop"}
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }

    monkeypatch.setattr("app.rag.llm._send", fake_send)

    answer = generate_answer("How do I stop late blight?", ["Late blight guidance."])

    assert tried == ["first/model", "second/model"]
    assert answer.model == "second/model"
    assert answer.text == "Remove the leaves [1]."


def test_an_empty_response_from_every_model_fails_cleanly(monkeypatch) -> None:
    """If nothing answers, the farmer gets an apology — not an empty bubble."""
    settings = Settings(
        openrouter_api_key="key",
        openrouter_model="only/model",
        openrouter_fallback_models="",
        gemini_api_key="",
    )
    monkeypatch.setattr("app.rag.llm.get_settings", lambda: settings)
    monkeypatch.setattr(
        "app.rag.llm._send",
        lambda request, *, provider, model, timeout=60: {
            "choices": [{"message": {"content": ""}, "finish_reason": "stop"}]
        },
    )

    with pytest.raises(AssistantUnavailableError):
        generate_answer("How do I stop late blight?", ["Late blight guidance."])


def test_a_rate_limit_moves_on_without_burning_the_backoff(monkeypatch) -> None:
    """429 is a per-model quota, so retrying the same model helps nobody.

    The old path slept 3s then 6s per rate-limited model before moving on. With
    several rate-limited models ahead of a working one, the farmer waited for
    nothing.
    """
    import urllib.error

    from app.rag.llm import _RetryableModelError, _send

    settings = Settings(openrouter_api_key="key", gemini_api_key="")
    monkeypatch.setattr("app.rag.llm.get_settings", lambda: settings)

    calls = {"n": 0}
    sleeps: list[float] = []

    def fake_urlopen(request, timeout=None):
        calls["n"] += 1
        raise urllib.error.HTTPError(request.full_url, 429, "Too Many Requests", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("app.rag.llm.time.sleep", lambda seconds: sleeps.append(seconds))

    request = _build_request("openrouter", "some/model", {"messages": []})
    with pytest.raises(_RetryableModelError):
        _send(request, provider="openrouter", model="some/model")

    assert calls["n"] == 1, "a 429 must not be retried against the same model"
    assert sleeps == [], "a 429 must not spend the backoff budget"


@pytest.mark.parametrize(
    ("openrouter", "gemini", "expected"),
    [
        ("or-key", "gm-key", "openrouter/model"),
        ("or-key", "", "openrouter/model"),
        ("", "gm-key", "gemini-model"),
    ],
)
def test_primary_chat_model_names_the_live_provider(
    openrouter: str, gemini: str, expected: str
) -> None:
    """Both status endpoints report this, so it must name the live provider.

    It did not: the health check reported `gemini_model` while OpenRouter was
    primary, so the dependency report named a model that never answered.
    """
    settings = Settings(
        openrouter_api_key=openrouter,
        openrouter_model="openrouter/model",
        gemini_api_key=gemini,
        gemini_model="gemini-model",
    )
    assert settings.primary_chat_model == expected
