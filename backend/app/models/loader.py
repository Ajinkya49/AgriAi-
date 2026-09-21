"""Model loading service.

The TRD requires the model to be **loaded once at API startup**, not per request.
`app/main.py` calls `load_model()` from its lifespan handler; request handlers
only ever read the already-loaded singleton.

Design notes:
  * torch is imported lazily inside the functions so the module (and therefore
    `app.main`) stays importable even if the ML dependencies are not installed —
    the API then reports the model as unavailable instead of failing to boot.
  * A missing or incompatible checkpoint is a *soft* failure: `/api/diagnose`
    returns 503 with a clear message rather than the whole service refusing to
    start.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.core.logging import get_logger
from app.models.labels import DISEASE_CLASSES, INPUT_SIZE, DiseaseClass

logger = get_logger(__name__)


@dataclass
class LoadedModel:
    """The in-memory model plus everything needed to interpret its output."""

    model: Any  # torch.nn.Module
    classes: tuple[DiseaseClass, ...]
    version: str
    architecture: str = "efficientnet_b0"
    trained_at: str | None = None
    metrics: dict[str, Any] = field(default_factory=dict)

    @property
    def num_classes(self) -> int:
        return len(self.classes)


_state: LoadedModel | None = None
_load_error: str | None = None


def get_loaded_model() -> LoadedModel | None:
    """The loaded model, or None if it has not been loaded successfully."""
    return _state


def get_load_error() -> str | None:
    """Why loading failed, if it did. Surfaced by the health endpoint."""
    return _load_error


def build_model(num_classes: int, *, pretrained_backbone: bool = False) -> Any:
    """Construct EfficientNet-B0 with a classifier head sized to `num_classes`.

    Used by both the loader and `scripts/train_model.py`, so training and serving
    can never drift apart architecturally.
    """
    from torch import nn
    from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0

    weights = EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained_backbone else None
    model = efficientnet_b0(weights=weights)

    in_features = model.classifier[1].in_features
    model.classifier[1] = nn.Linear(in_features, num_classes)
    return model


def load_model(*, force: bool = False) -> LoadedModel | None:
    """Load the checkpoint named by `MODEL_PATH` into memory.

    Returns the loaded model, or None if it could not be loaded (the reason is
    available from `get_load_error()`).
    """
    global _state, _load_error

    if _state is not None and not force:
        return _state

    settings = get_settings()
    path = Path(settings.model_path)
    if not path.is_absolute():
        # MODEL_PATH is documented as relative to backend/.
        path = Path(__file__).resolve().parents[2] / settings.model_path

    if not path.exists():
        _load_error = (
            f"No model weights at {path}. Train one with "
            f"`python scripts/train_model.py`, or set MODEL_PATH."
        )
        logger.warning("Model not loaded: %s", _load_error)
        return None

    try:
        import torch

        # Avoid thread oversubscription on small inference workloads.
        torch.set_num_threads(min(4, torch.get_num_threads()))

        checkpoint = torch.load(path, map_location="cpu", weights_only=False)

        classes = DISEASE_CLASSES
        stored_names = checkpoint.get("class_names")
        if stored_names is not None and list(stored_names) != [c.disease_name for c in classes]:
            # The checkpoint was trained against a different taxonomy. Serving it
            # would map indices to the wrong disease names, which is worse than
            # not serving at all.
            _load_error = (
                "Checkpoint class list does not match app.models.labels.DISEASE_CLASSES. "
                "Retrain with the current taxonomy."
            )
            logger.error("Model not loaded: %s", _load_error)
            return None

        model = build_model(len(classes))
        model.load_state_dict(checkpoint["state_dict"])
        model.eval()

        _state = LoadedModel(
            model=model,
            classes=classes,
            version=checkpoint.get("model_version", settings.model_version),
            architecture=checkpoint.get("architecture", "efficientnet_b0"),
            trained_at=checkpoint.get("trained_at"),
            metrics=checkpoint.get("metrics", {}),
        )
        _load_error = None
        logger.info(
            "Model loaded: %s classes, version %s%s",
            _state.num_classes,
            _state.version,
            f", trained {_state.trained_at}" if _state.trained_at else "",
        )
        if _state.metrics:
            logger.info("Checkpoint metrics: %s", json.dumps(_state.metrics))
        return _state

    except Exception as exc:  # noqa: BLE001 - a bad checkpoint must not kill startup
        _load_error = f"Could not load the model: {exc}"
        logger.exception("Model load failed")
        return None


def unload_model() -> None:
    """Drop the loaded model (used by tests)."""
    global _state, _load_error
    _state = None
    _load_error = None


def model_input_size() -> int:
    """The square input resolution the model expects."""
    return INPUT_SIZE
