"""The assistant pipeline: retrieve → generate → assemble citations.

Kept separate from the route handler so the whole thing can be exercised without
HTTP, and so the grounding rules live in one place rather than being spread across
`retriever.py` and `llm.py`.

The one non-obvious thing here is **query augmentation**. A follow-up question
after a diagnosis is often just "what should I do about it?" — which retrieves
nothing useful on its own. When a diagnosis is in play, its crop and disease are
prepended to the *search query* (not to what the model is shown as the question),
so retrieval has something to work with.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.logging import get_logger
from app.rag.llm import (
    REFUSAL_BY_LANGUAGE,
    AssistantUnavailableError,
    detect_language,
    generate_answer,
)
from app.rag.retriever import retrieve

logger = get_logger(__name__)


@dataclass(frozen=True)
class DiagnosisContext:
    """A recent photo diagnosis, used to tailor the answer."""

    crop_type: str
    predicted_disease: str
    confidence_score: float
    model_version: str
    symptoms_summary: str | None = None

    def as_prompt_text(self) -> str:
        lines = [
            f"- Crop: {self.crop_type}",
            f"- Predicted condition: {self.predicted_disease}",
            f"- Model confidence: {round(self.confidence_score * 100)}% "
            "(a prediction, not a confirmed diagnosis)",
            f"- Detected by model version: {self.model_version}",
        ]
        if self.symptoms_summary:
            lines.append(f"- What the model looked for: {self.symptoms_summary}")
        return "\n".join(lines)

    def as_search_terms(self) -> str:
        """Crop and disease, for augmenting the retrieval query."""
        display = self.predicted_disease.replace(f"{self.crop_type} - ", "")
        return f"{self.crop_type} {display}"


@dataclass(frozen=True)
class AssistantAnswer:
    answer: str
    sources: list[dict] = field(default_factory=list)
    refused: bool = False
    model: str = ""
    retrieval_scores: list[float] = field(default_factory=list)


def answer_question(
    question: str,
    *,
    diagnosis: DiagnosisContext | None = None,
) -> AssistantAnswer:
    """Answer a farmer's question from the curated knowledge base.

    Raises `AssistantUnavailableError` when the model could not be reached — the
    route turns that into a 503, because "we could not answer right now" is a
    different message from "we have no information about that".
    """
    question = question.strip()
    if not question:
        raise AssistantUnavailableError("Please type a question.")

    search_query = question
    if diagnosis is not None:
        # "what should I do about it?" on its own retrieves nothing.
        search_query = f"{diagnosis.as_search_terms()} — {question}"
        logger.debug("Augmented retrieval query: %r", search_query[:120])

    result = retrieve(search_query)

    if result.is_empty:
        # Nothing relevant. Do not call the model — it would either refuse anyway
        # (wasting a request) or, worse, answer from its own priors.
        logger.info("No relevant knowledge-base chunks for %r", question[:80])
        return AssistantAnswer(
            # In the farmer's language: a Hindi speaker asking an off-topic
            # question must not get an English refusal.
            answer=REFUSAL_BY_LANGUAGE[detect_language(question)],
            sources=[],
            refused=True,
        )

    generated = generate_answer(
        question,
        result.passages(),
        diagnosis_context=diagnosis.as_prompt_text() if diagnosis else None,
    )

    # Only surface the sources the answer actually used. Listing passages the model
    # ignored makes the citations decorative rather than evidence.
    all_sources = result.sources()
    used = [s for s in all_sources if s["index"] in generated.cited] or all_sources

    return AssistantAnswer(
        answer=generated.text,
        sources=used,
        refused=generated.refused,
        model=generated.model,
        retrieval_scores=[round(c.score, 4) for c in result.chunks],
    )
