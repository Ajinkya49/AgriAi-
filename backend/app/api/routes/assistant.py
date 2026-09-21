"""AI farming assistant endpoints (Phase 6).

Answers are generated **only from retrieved knowledge-base passages**, and every
answer carries the sources it used. The assistant never diagnoses an image — that
is `app.models`, PyTorch, with no LLM involved — and it never invents a Natural or
Traditional solution, which come from the curated `solutions` table.

Chat runs on OpenRouter with Gemini as a fallback; both are conversation-only.
Answers come back in the language the farmer asked in (English or Hindi).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from app.config import get_settings
from app.core.logging import get_logger
from app.core.security import BearerToken, CurrentUser, user_scoped_client
from app.rag.index import get_index, get_load_error
from app.rag.llm import AssistantUnavailableError
from app.rag.pipeline import DiagnosisContext, answer_question
from app.schemas.assistant import (
    AskRequest,
    AskResponse,
    AssistantStatusOut,
    ConversationListOut,
    ConversationOut,
    MessageOut,
    SourceOut,
)

logger = get_logger(__name__)

router = APIRouter(tags=["assistant"])

# Shown as tappable starters. Chosen to map onto areas the knowledge base
# actually covers, so a farmer's first question is likely to get a real answer.
SUGGESTED_QUESTIONS = [
    "My tomato leaves have brown spots with rings. What should I do?",
    "How do I know if it is late blight or early blight?",
    "How do I make panchagavya?",
    "What is the right way to treat my seeds before sowing?",
    "Why do my plants keep getting fungal disease every season?",
    "How much should I water my tomato crop?",
]

# The same starters in Hindi. These are not translations for decoration: the
# audience is smallholder farmers, many of whom do not read English, and a farmer
# who cannot read the starter chips will not discover that Hindi works at all.
SUGGESTED_QUESTIONS_HI = [
    "मेरे टमाटर के पत्तों पर गोल छल्लों वाले भूरे धब्बे हैं। क्या करूँ?",
    "लेट ब्लाइट और अर्ली ब्लाइट में फर्क कैसे पता करूँ?",
    "पंचगव्य कैसे बनाते हैं?",
    "बुवाई से पहले बीज का उपचार कैसे करें?",
    "हर सीज़न में मेरे पौधों को फंगस क्यों लग जाती है?",
    "टमाटर की फसल को कितना पानी देना चाहिए?",
]


def _source_rows(payload: list[dict]) -> list[dict]:
    """Normalise stored sources back into the response shape."""
    return [
        {
            "index": item.get("index", i + 1),
            "source": item.get("source", "unknown"),
            "score": float(item.get("score", 0.0)),
            "excerpt": item.get("excerpt", ""),
        }
        for i, item in enumerate(payload or [])
    ]


def _message_out(row: dict) -> MessageOut:
    return MessageOut(
        id=str(row["id"]),
        role=row["role"],
        content=row["content"],
        sources=[SourceOut(**_s) for _s in _source_rows(row.get("retrieved_sources"))],
        created_at=str(row["created_at"]),
    )


@router.get("/assistant/status", response_model=AssistantStatusOut)
async def assistant_status() -> AssistantStatusOut:
    """Report whether the assistant can answer, and offer starter questions."""

    index = get_index()
    settings = get_settings()

    if index is None:
        return AssistantStatusOut(
            available=False,
            index_loaded=False,
            error=get_load_error(),
            chat_model=settings.primary_chat_model,
            suggested_questions=SUGGESTED_QUESTIONS,
            suggested_questions_hi=SUGGESTED_QUESTIONS_HI,
        )

    return AssistantStatusOut(
        # `is_rag_configured`, not `bool(gemini_api_key)`: OpenRouter is a valid
        # provider on its own, and checking only the Gemini key would report the
        # assistant as down while it was working perfectly well.
        available=settings.is_rag_configured,
        index_loaded=True,
        chunk_count=index.chunk_count,
        embedding_model=index.embedding_model,
        built_at=index.built_at,
        chat_model=settings.primary_chat_model,
        suggested_questions=SUGGESTED_QUESTIONS,
        suggested_questions_hi=SUGGESTED_QUESTIONS_HI,
    )


@router.post("/assistant/message", response_model=AskResponse, status_code=status.HTTP_201_CREATED)
async def ask_assistant(
    payload: AskRequest,
    user: CurrentUser,
    token: BearerToken,
) -> AskResponse:
    """Ask the farming assistant a question."""
    if get_index() is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The farming assistant is not available yet. Please try again later.",
        )

    question = payload.message.strip()
    if not question:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please type a question.",
        )

    def _prepare() -> tuple[str, DiagnosisContext | None, dict]:
        """Load the diagnosis (if any), then get or create the conversation."""
        client = user_scoped_client(token)
        diagnosis_context: DiagnosisContext | None = None
        diagnosis_row: dict | None = None

        if payload.diagnosis_id:
            result = (
                client.table("diagnoses")
                .select("*")
                .eq("id", payload.diagnosis_id)
                .limit(1)
                .execute()
            )
            rows = result.data or []
            if not rows:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="We couldn't find that diagnosis.",
                )
            diagnosis_row = rows[0]
            diagnosis_context = DiagnosisContext(
                crop_type=diagnosis_row["crop_type"],
                predicted_disease=diagnosis_row["predicted_disease"],
                confidence_score=float(diagnosis_row["confidence_score"]),
                model_version=diagnosis_row["model_version"],
                symptoms_summary=diagnosis_row.get("symptoms_summary"),
            )

        # Reuse the thread for this diagnosis if there is one; otherwise start a
        # fresh conversation. RLS keeps this scoped to the caller either way.
        conversation_id = payload.conversation_id
        if conversation_id:
            existing = (
                client.table("assistant_conversations")
                .select("id")
                .eq("id", conversation_id)
                .limit(1)
                .execute()
            )
            if not existing.data:
                conversation_id = None

        if not conversation_id:
            created = (
                client.table("assistant_conversations")
                .insert(
                    {
                        "id": str(uuid.uuid4()),
                        "user_id": user.id,
                        "diagnosis_id": diagnosis_row["id"] if diagnosis_row else None,
                    }
                )
                .execute()
            )
            if not created.data:
                raise RuntimeError("Could not start a conversation")
            conversation_id = created.data[0]["id"]

        user_message = (
            client.table("assistant_messages")
            .insert(
                {
                    "id": str(uuid.uuid4()),
                    "conversation_id": conversation_id,
                    "role": "user",
                    "content": question,
                }
            )
            .execute()
        )
        if not user_message.data:
            raise RuntimeError("Could not store the question")

        return conversation_id, diagnosis_context, user_message.data[0]

    try:
        conversation_id, diagnosis_context, _ = await run_in_threadpool(_prepare)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Could not prepare the conversation")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Something went wrong. Please try again.",
        ) from exc

    # ---- Generate --------------------------------------------------------
    try:
        result = await run_in_threadpool(answer_question, question, diagnosis=diagnosis_context)
    except AssistantUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Assistant generation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="I couldn't answer that right now. Please try again in a moment.",
        ) from exc

    # ---- Store the answer ------------------------------------------------
    def _store() -> dict:
        client = user_scoped_client(token)
        stored = (
            client.table("assistant_messages")
            .insert(
                {
                    "id": str(uuid.uuid4()),
                    "conversation_id": conversation_id,
                    "role": "assistant",
                    "content": result.answer,
                    "retrieved_sources": result.sources,
                }
            )
            .execute()
        )
        if not stored.data:
            raise RuntimeError("Could not store the answer")
        return stored.data[0]

    try:
        assistant_row = await run_in_threadpool(_store)
    except Exception:  # noqa: BLE001
        # The answer is already generated; failing to persist it should not lose
        # it for the farmer. Log and return it anyway.
        logger.exception("Could not persist the assistant message")
        return AskResponse(
            conversation_id=conversation_id,
            message_id="",
            answer=result.answer,
            sources=[SourceOut(**s) for s in result.sources],
            model=result.model,
            refused=result.refused,
        )

    return AskResponse(
        conversation_id=conversation_id,
        message_id=str(assistant_row["id"]),
        answer=result.answer,
        sources=[SourceOut(**s) for s in result.sources],
        model=result.model,
        refused=result.refused,
    )


@router.get("/assistant/conversations", response_model=ConversationListOut)
async def list_conversations(user: CurrentUser, token: BearerToken) -> ConversationListOut:
    """The caller's own assistant threads, most recent first."""

    def _fetch() -> list[dict]:
        client = user_scoped_client(token)
        result = (
            client.table("assistant_conversations")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        return result.data or []

    rows = await run_in_threadpool(_fetch)
    return ConversationListOut(
        items=[
            ConversationOut(
                id=str(r["id"]),
                diagnosis_id=r.get("diagnosis_id"),
                created_at=str(r["created_at"]),
            )
            for r in rows
        ],
        total=len(rows),
    )


@router.get("/assistant/conversations/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: str, user: CurrentUser, token: BearerToken
) -> ConversationOut:
    """One thread with its full message history."""

    def _fetch() -> tuple[dict | None, list[dict]]:
        client = user_scoped_client(token)
        conversation = (
            client.table("assistant_conversations")
            .select("*")
            .eq("id", conversation_id)
            .limit(1)
            .execute()
        )
        rows = conversation.data or []
        if not rows:
            return None, []

        messages = (
            client.table("assistant_messages")
            .select("*")
            .eq("conversation_id", conversation_id)
            .order("created_at")
            .execute()
        )
        return rows[0], messages.data or []

    conversation, messages = await run_in_threadpool(_fetch)
    if conversation is None:
        # Same response for "does not exist" and "belongs to someone else".
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="We couldn't find that conversation.",
        )

    return ConversationOut(
        id=str(conversation["id"]),
        diagnosis_id=conversation.get("diagnosis_id"),
        created_at=str(conversation["created_at"]),
        messages=[_message_out(m) for m in messages],
    )
