"""Disease detection endpoints.

Flow: upload image -> validate/preprocess (Pillow) -> inference (PyTorch) ->
store image in Supabase Storage -> insert a row in `diagnoses` -> return the
result with a confidence score.

The model is never reloaded per request; `app.main` loads it once at startup.

Gemini is not involved anywhere in this module, and must never be — the LLM does
not diagnose images.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from app.core.logging import get_logger
from app.core.security import BearerToken, CurrentUser, user_scoped_client
from app.core.storage import (
    StorageError,
    diagnosis_image_path,
    remove_image,
    signed_url,
    upload_image,
)
from app.knowledge_base.solutions import SolutionsForDisease, fetch_for_disease
from app.models.inference import ModelNotAvailableError, predict
from app.models.loader import get_load_error, get_loaded_model
from app.models.preprocessing import ImageValidationError, prepare_image
from app.schemas.diagnosis import (
    AlternativeOut,
    DiagnosisListOut,
    DiagnosisOut,
    ModelInfoOut,
)

logger = get_logger(__name__)

router = APIRouter(tags=["diagnosis"])


@router.get("/model", response_model=ModelInfoOut)
async def model_info() -> ModelInfoOut:
    """Report which model the API has loaded (or why it has not)."""
    model = get_loaded_model()
    if model is None:
        return ModelInfoOut(loaded=False, error=get_load_error())
    return ModelInfoOut(
        loaded=True,
        version=model.version,
        architecture=model.architecture,
        num_classes=model.num_classes,
        trained_at=model.trained_at,
        classes=[c.disease_name for c in model.classes],
        metrics=model.metrics,
    )


@router.post("/diagnose", response_model=DiagnosisOut, status_code=status.HTTP_201_CREATED)
async def diagnose(
    user: CurrentUser,
    token: BearerToken,
    file: Annotated[UploadFile, File(description="Crop photo (JPEG, PNG or WEBP)")],
) -> DiagnosisOut:
    """Analyse a crop photo and store the result."""
    if get_loaded_model() is None:
        # 503 rather than 500: the service is fine, the model just is not ready.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Disease detection is temporarily unavailable. Please try again shortly.",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No image was received. Please choose a photo and try again.",
        )

    # ---- Validate + preprocess ------------------------------------------
    try:
        prepared = await run_in_threadpool(prepare_image, raw)
    except ImageValidationError as exc:
        # Message is written for a farmer, so pass it through.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    # ---- Inference -------------------------------------------------------
    try:
        prediction = await run_in_threadpool(predict, prepared.array)
    except ModelNotAvailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Disease detection is temporarily unavailable. Please try again shortly.",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Inference failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We couldn't analyse this image right now. Please try again in a moment.",
        ) from exc

    # ---- Persist ---------------------------------------------------------
    # Generate the id first: the storage path embeds it.
    diagnosis_id = str(uuid.uuid4())
    object_path = diagnosis_image_path(user.id, diagnosis_id)
    content_type = file.content_type or "image/jpeg"

    try:
        await run_in_threadpool(upload_image, object_path, raw, content_type=content_type)
    except StorageError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    row = {
        "id": diagnosis_id,
        "user_id": user.id,
        "image_url": object_path,
        "crop_type": prediction.crop_type,
        "predicted_disease": prediction.predicted_disease,
        "confidence_score": prediction.confidence_score,
        "symptoms_summary": prediction.symptoms_summary,
        "model_version": get_loaded_model().version if get_loaded_model() else "unknown",
    }

    def _insert_and_match() -> tuple[dict, SolutionsForDisease]:
        # User-scoped client: RLS enforces user_id = auth.uid(), so even a bug
        # here cannot write a diagnosis onto another farmer's account.
        client = user_scoped_client(token)
        result = client.table("diagnoses").insert(row).execute()
        rows = result.data or []
        if not rows:
            raise RuntimeError("Insert returned no row")
        # Matched from the curated knowledge base — never generated.
        grouped = fetch_for_disease(client, prediction.predicted_disease)
        return rows[0], grouped

    try:
        saved, solutions = await run_in_threadpool(_insert_and_match)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to store diagnosis %s", diagnosis_id)
        # Do not leave an orphaned image behind.
        await run_in_threadpool(remove_image, object_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We couldn't save your result. Please try again in a moment.",
        ) from exc

    signed = await run_in_threadpool(signed_url, object_path)

    return DiagnosisOut.from_row(
        saved,
        image_signed_url=signed,
        alternatives=[
            AlternativeOut(
                disease_name=a.disease_name,
                display_name=a.display_name,
                confidence_score=a.confidence_score,
            )
            for a in prediction.alternatives
        ],
        solutions=DiagnosisOut.solutions_from(solutions),
    )


@router.get("/diagnoses/user/{user_id}", response_model=DiagnosisListOut)
async def list_user_diagnoses(
    user_id: str, user: CurrentUser, token: BearerToken
) -> DiagnosisListOut:
    """Dashboard history for one farmer.

    RLS already restricts this to the caller's own rows; the explicit check just
    turns a silently-empty list into a clear 403.
    """
    if user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own diagnoses.",
        )

    def _fetch() -> list[dict]:
        client = user_scoped_client(token)
        result = (
            client.table("diagnoses")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        return result.data or []

    rows = await run_in_threadpool(_fetch)
    items = [
        DiagnosisOut.from_row(
            r, image_signed_url=await run_in_threadpool(signed_url, r["image_url"])
        )
        for r in rows
    ]
    return DiagnosisListOut(items=items, total=len(items))


@router.get("/diagnoses/{diagnosis_id}", response_model=DiagnosisOut)
async def get_diagnosis(diagnosis_id: str, user: CurrentUser, token: BearerToken) -> DiagnosisOut:
    """Fetch one diagnosis together with its matched Natural / Traditional solutions."""

    def _fetch() -> tuple[dict | None, SolutionsForDisease | None]:
        client = user_scoped_client(token)
        result = client.table("diagnoses").select("*").eq("id", diagnosis_id).limit(1).execute()
        rows = result.data or []
        if not rows:
            return None, None
        return rows[0], fetch_for_disease(client, rows[0]["predicted_disease"])

    row, solutions = await run_in_threadpool(_fetch)
    if row is None:
        # Same response whether it does not exist or belongs to someone else —
        # do not leak the existence of other farmers' diagnoses.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="We couldn't find that diagnosis.",
        )

    signed = await run_in_threadpool(signed_url, row["image_url"])
    return DiagnosisOut.from_row(
        row,
        image_signed_url=signed,
        solutions=DiagnosisOut.solutions_from(solutions),
    )
