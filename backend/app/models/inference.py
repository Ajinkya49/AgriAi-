"""Disease inference.

Takes a preprocessed image array and returns a structured prediction.

Product rules enforced here (not just in the UI):
  * every prediction carries a confidence score — there is no code path that
    returns a diagnosis without one;
  * low confidence is a *normal result state*, not an error, and sets
    `needs_expert_confirmation`;
  * the top few alternatives are returned so the UI can show what else the model
    considered rather than presenting one answer as fact.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.logging import get_logger
from app.models.labels import (
    CONFIDENCE_HIGH_THRESHOLD,
    CONFIDENCE_LOW_THRESHOLD,
    CONFIDENCE_UNRELIABLE_THRESHOLD,
    DiseaseClass,
)
from app.models.loader import LoadedModel, get_loaded_model

logger = get_logger(__name__)


class ModelNotAvailableError(RuntimeError):
    """Raised when inference is attempted with no model loaded."""


@dataclass(frozen=True)
class Alternative:
    disease_name: str
    display_name: str
    confidence_score: float


@dataclass(frozen=True)
class Prediction:
    crop_type: str
    predicted_disease: str
    display_name: str
    confidence_score: float
    symptoms_summary: str
    is_healthy: bool
    confidence_band: str
    needs_expert_confirmation: bool
    is_reliable: bool
    alternatives: tuple[Alternative, ...]


def _band(score: float) -> str:
    if score >= CONFIDENCE_HIGH_THRESHOLD:
        return "high"
    if score >= CONFIDENCE_LOW_THRESHOLD:
        return "medium"
    return "low"


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits)
    exp = np.exp(shifted)
    return exp / exp.sum()


def _run_forward(model: LoadedModel, array: np.ndarray) -> np.ndarray:
    import torch

    tensor = torch.from_numpy(array).unsqueeze(0)  # (1, 3, H, W)
    with torch.inference_mode():
        logits = model.model(tensor)
    return logits.squeeze(0).to(torch.float32).numpy()


def predict(array: np.ndarray, *, top_k: int = 3) -> Prediction:
    """Classify a preprocessed image array.

    `array` must be float32 with shape (3, 224, 224) — the output of
    `preprocessing.prepare_image`.
    """
    model = get_loaded_model()
    if model is None:
        raise ModelNotAvailableError("The disease detection model is not loaded.")

    probabilities = _softmax(_run_forward(model, array))
    order = np.argsort(probabilities)[::-1]

    best_index = int(order[0])
    best: DiseaseClass = model.classes[best_index]
    confidence = float(probabilities[best_index])

    alternatives = tuple(
        Alternative(
            disease_name=model.classes[int(i)].disease_name,
            display_name=model.classes[int(i)].display_name,
            confidence_score=float(probabilities[int(i)]),
        )
        for i in order[1 : top_k + 1]
    )

    is_healthy = best.display_name == "Healthy"

    return Prediction(
        crop_type=best.crop_type,
        predicted_disease=best.disease_name,
        display_name=best.display_name,
        confidence_score=confidence,
        symptoms_summary=best.symptoms,
        is_healthy=is_healthy,
        confidence_band=_band(confidence),
        # Product principle: prompt for expert confirmation when the model is not
        # confident. Never silently present a low-confidence guess as settled.
        #
        # Gated on the LOW band, not the HIGH one. It previously fired for
        # everything below 70%, so a 69% result — a solid call on a 10-class
        # problem — still carried a full-width "confirm with your local KVK"
        # warning. At that rate the prompt becomes wallpaper and stops being
        # read, which is worse than not showing it at all. The medium band is
        # still signalled, by the amber bar and the "Medium confidence" label.
        needs_expert_confirmation=confidence < CONFIDENCE_LOW_THRESHOLD,
        is_reliable=confidence >= CONFIDENCE_UNRELIABLE_THRESHOLD,
        alternatives=alternatives,
    )
