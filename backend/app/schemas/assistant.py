"""Pydantic models for the assistant endpoints (Phase 6)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class SourceOut(BaseModel):
    """A knowledge-base excerpt the answer drew on."""

    index: int
    source: str
    score: float
    excerpt: str


class AskRequest(BaseModel):
    """A question from the farmer."""

    message: str = Field(min_length=1, max_length=1000)
    # When set, the question is treated as a follow-up to this diagnosis and the
    # assistant tailors its answer to that crop and condition.
    diagnosis_id: str | None = None
    # Continue an existing thread instead of starting a new one.
    conversation_id: str | None = None


class MessageOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    role: str
    content: str
    sources: list[SourceOut] = Field(default_factory=list)
    created_at: str


class AskResponse(BaseModel):
    """The assistant's answer, with its evidence."""

    conversation_id: str
    message_id: str
    answer: str
    sources: list[SourceOut] = Field(default_factory=list)
    model: str
    # True when the knowledge base did not cover the question. The UI shows this
    # differently from a normal answer rather than pretending it answered.
    refused: bool = False


class ConversationOut(BaseModel):
    id: str
    diagnosis_id: str | None = None
    created_at: str
    messages: list[MessageOut] = Field(default_factory=list)


class ConversationListOut(BaseModel):
    items: list[ConversationOut]
    total: int


class AssistantStatusOut(BaseModel):
    """Whether the assistant can answer right now."""

    available: bool
    index_loaded: bool
    chunk_count: int | None = None
    embedding_model: str | None = None
    built_at: str | None = None
    chat_model: str | None = None
    error: str | None = None
    suggested_questions: list[str] = Field(default_factory=list)
    # Both languages are returned so the UI can switch instantly, without a round
    # trip. A farmer on a slow rural connection should not wait on a refetch to
    # read a suggestion chip.
    suggested_questions_hi: list[str] = Field(default_factory=list)
    # Languages the assistant will answer in. Advertised so the UI does not have
    # to hard-code the list.
    supported_languages: list[str] = Field(default_factory=lambda: ["en", "hi"])
