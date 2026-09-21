"""Phase 4 — model loading and inference tests.

These need the trained checkpoint, so the whole module skips if it is absent.
That keeps `pytest` green on a fresh clone before anyone has trained a model,
while still covering the real serving path once weights exist.

    python scripts/train_model.py --data-root <plantvillage> --mode head
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from app.models.inference import ModelNotAvailableError, predict
from app.models.labels import (
    CONFIDENCE_HIGH_THRESHOLD,
    CONFIDENCE_LOW_THRESHOLD,
    DISEASE_CLASSES,
)
from app.models.loader import get_loaded_model, load_model, unload_model
from app.models.preprocessing import prepare_image

WEIGHTS = (
    Path(__file__).resolve().parents[1] / "app" / "models" / "weights" / "efficientnet_b0_agri.pt"
)

pytestmark = pytest.mark.skipif(
    not WEIGHTS.exists(), reason="no trained checkpoint — run scripts/train_model.py"
)


@pytest.fixture(scope="module")
def model():
    loaded = load_model(force=True)
    assert loaded is not None, "checkpoint exists but failed to load"
    yield loaded
    unload_model()


def leaf_bytes() -> bytes:
    """A synthetic 'leaf' — enough to exercise the pipeline, not to be accurate."""
    buffer = io.BytesIO()
    image = Image.new("RGB", (400, 300), (74, 124, 58))
    # Add some darker blotches so the input is not perfectly flat.
    for x in range(60, 340, 40):
        for y in range(60, 240, 40):
            for dx in range(20):
                for dy in range(20):
                    image.putpixel((x + dx, y + dy), (48, 82, 36))
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def test_checkpoint_classes_match_the_taxonomy(model) -> None:
    """A checkpoint whose classes disagree with labels.py must never be served."""
    assert [c.disease_name for c in model.classes] == [c.disease_name for c in DISEASE_CLASSES]


def test_checkpoint_records_its_metrics(model) -> None:
    assert model.metrics.get("val_accuracy", 0) > 0.5
    assert model.trained_at


def test_predict_returns_a_confidence_score(model) -> None:
    prediction = predict(prepare_image(leaf_bytes()).array)

    assert 0.0 <= prediction.confidence_score <= 1.0
    assert prediction.predicted_disease in [c.disease_name for c in DISEASE_CLASSES]
    assert prediction.crop_type
    assert prediction.symptoms_summary


def test_confidence_band_follows_the_thresholds(model) -> None:
    prediction = predict(prepare_image(leaf_bytes()).array)
    score = prediction.confidence_score

    if score >= CONFIDENCE_HIGH_THRESHOLD:
        assert prediction.confidence_band == "high"
        assert prediction.needs_expert_confirmation is False
    elif score >= CONFIDENCE_LOW_THRESHOLD:
        assert prediction.confidence_band == "medium"
        # Medium is still signalled — amber bar, "Medium confidence" label — but
        # does NOT raise the expert-confirmation prompt. Gating that on the HIGH
        # threshold meant it fired on almost every result and stopped being read.
        assert prediction.needs_expert_confirmation is False
    else:
        assert prediction.confidence_band == "low"
        assert prediction.needs_expert_confirmation is True


def test_alternatives_are_ordered_and_exclude_the_top_class(model) -> None:
    prediction = predict(prepare_image(leaf_bytes()).array)

    scores = [a.confidence_score for a in prediction.alternatives]
    assert scores == sorted(scores, reverse=True)
    assert prediction.predicted_disease not in [a.disease_name for a in prediction.alternatives]


def test_predict_raises_when_no_model_is_loaded() -> None:
    unload_model()
    try:
        with pytest.raises(ModelNotAvailableError):
            predict(prepare_image(leaf_bytes()).array)
    finally:
        load_model(force=True)


def test_is_healthy_flag_matches_the_predicted_class(model) -> None:
    prediction = predict(prepare_image(leaf_bytes()).array)
    assert prediction.is_healthy == (prediction.display_name == "Healthy")


def test_load_model_is_cached(model) -> None:
    """The TRD requires one load at startup, not a reload per request.

    Asserted by identity rather than against the fixture, because an earlier test
    deliberately unloads and reloads.
    """
    assert load_model() is get_loaded_model()
    assert get_loaded_model() is not None
