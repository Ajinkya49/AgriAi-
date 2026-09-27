"""Disease class taxonomy for the v1 detection model.

STRICT BOUNDARY: this package is PyTorch-only. It must never import from
`app.rag` or touch Gemini. Gemini never diagnoses images.

The `disease_name` strings here are the join key between a prediction and the
curated knowledge base: `diagnoses.predicted_disease` is matched **exactly**
against `solutions.disease_name`. If you rename a class, you must rename the
matching `solutions` rows too — there is no fuzzy matching.

Taxonomy format (fixed): `"<Crop> - <Disease>"`.

The class order below defines the classifier head's output ordering. It must stay
in sync with whatever `scripts/train_model.py` produced, so the saved checkpoint
stores its own copy of this list and `loader.py` verifies the two agree.
"""

from __future__ import annotations

from dataclasses import dataclass

# ImageNet normalisation statistics — EfficientNet-B0 was pretrained with these,
# and the fine-tuned head expects the same input distribution.
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)

# EfficientNet-B0's native input resolution.
INPUT_SIZE = 224


@dataclass(frozen=True)
class DiseaseClass:
    """One output class of the classifier."""

    index: int
    crop_type: str
    disease_name: str
    display_name: str
    symptoms: str


# ---------------------------------------------------------------------------
# v1 curated set — 10 classes across 3 crops.
#
# Chosen from PlantVillage because these are common, visually distinctive, and
# relevant to Indian smallholders. The PRD deliberately scopes v1 to "a small,
# curated set" rather than all 38 PlantVillage classes.
#
# NOTE: PlantVillage contains no wheat imagery, so "Wheat - Leaf Rust" (which
# appears in the seed solutions) is NOT yet diagnosable. Adding it requires
# PlantDoc. See DECISIONS.md.
# ---------------------------------------------------------------------------
DISEASE_CLASSES: tuple[DiseaseClass, ...] = (
    DiseaseClass(
        index=0,
        crop_type="Tomato",
        disease_name="Tomato - Early Blight",
        display_name="Early Blight",
        symptoms=(
            "Dark brown spots with concentric rings (target-like) on the older, "
            "lower leaves first. Surrounding leaf tissue turns yellow, and "
            "heavily affected leaves dry up and drop."
        ),
    ),
    DiseaseClass(
        index=1,
        crop_type="Tomato",
        disease_name="Tomato - Late Blight",
        display_name="Late Blight",
        symptoms=(
            "Large, irregular water-soaked grey-green patches that turn brown and "
            "papery. A pale fuzzy white mould may appear on the underside of the "
            "leaf in humid weather. Spreads very fast in cool, wet conditions."
        ),
    ),
    DiseaseClass(
        index=2,
        crop_type="Tomato",
        disease_name="Tomato - Leaf Mold",
        display_name="Leaf Mold",
        symptoms=(
            "Pale yellow spots on the upper leaf surface that turn brown. A "
            "velvety olive-green to brown mould develops on the underside. "
            "Occurs mainly in humid, poorly ventilated conditions."
        ),
    ),
    DiseaseClass(
        index=3,
        crop_type="Tomato",
        disease_name="Tomato - Septoria Leaf Spot",
        display_name="Septoria Leaf Spot",
        symptoms=(
            "Many small circular spots with grey centres and dark margins, "
            "starting on the lowest leaves. Tiny black dots (spore bodies) are "
            "visible inside the spots. Leaves yellow and drop prematurely."
        ),
    ),
    DiseaseClass(
        index=4,
        crop_type="Tomato",
        disease_name="Tomato - Healthy",
        display_name="Healthy",
        symptoms="No disease symptoms detected. The leaf colour and texture look normal.",
    ),
    DiseaseClass(
        index=5,
        crop_type="Potato",
        disease_name="Potato - Early Blight",
        display_name="Early Blight",
        symptoms=(
            "Brown to black spots with concentric rings on older leaves, often "
            "with a yellow halo. Lesions may merge and cause the leaf to dry out "
            "and drop."
        ),
    ),
    DiseaseClass(
        index=6,
        crop_type="Potato",
        disease_name="Potato - Late Blight",
        display_name="Late Blight",
        symptoms=(
            "Water-soaked grey-green lesions that enlarge quickly into brown "
            "necrotic patches. White mould appears on leaf undersides in damp "
            "weather. Can destroy a field within days."
        ),
    ),
    DiseaseClass(
        index=7,
        crop_type="Potato",
        disease_name="Potato - Healthy",
        display_name="Healthy",
        symptoms="No disease symptoms detected. The leaf colour and texture look normal.",
    ),
    DiseaseClass(
        index=8,
        crop_type="Pepper",
        disease_name="Pepper - Bacterial Spot",
        display_name="Bacterial Spot",
        symptoms=(
            "Small water-soaked spots that turn brown to black and become "
            "angular as they are limited by leaf veins. Leaves may yellow and "
            "drop, leaving fruit exposed to sunscald."
        ),
    ),
    DiseaseClass(
        index=9,
        crop_type="Pepper",
        disease_name="Pepper - Healthy",
        display_name="Healthy",
        symptoms="No disease symptoms detected. The leaf colour and texture look normal.",
    ),
)

# ---------------------------------------------------------------------------
# Confidence banding.
#
# The UI/UX brief requires a confidence indicator on every result and an
# expert-confirmation prompt when confidence is low. These thresholds are the
# single source of truth for that decision on the backend.
# ---------------------------------------------------------------------------
CONFIDENCE_LOW_THRESHOLD = 0.45
CONFIDENCE_HIGH_THRESHOLD = 0.70

# Below this, the model is not meaningfully better than a guess, so the API
# refuses to name a disease at all rather than inventing one.
CONFIDENCE_UNRELIABLE_THRESHOLD = 0.30


def class_by_name(disease_name: str) -> DiseaseClass | None:
    """Look up a class by its taxonomy string."""
    for cls in DISEASE_CLASSES:
        if cls.disease_name == disease_name:
            return cls
    return None


def class_names() -> list[str]:
    """Ordered list of taxonomy strings, indexed by model output index."""
    return [c.disease_name for c in DISEASE_CLASSES]


# ---------------------------------------------------------------------------
# Crops this model can actually diagnose.
#
# Derived from the taxonomy above rather than hand-listed, so it can never drift
# from what the classifier was trained on. The frontend needs this: a farmer
# whose crop is not in here will get a confident-looking answer for whichever of
# the 10 trained classes happens to score highest, because a classifier with a
# fixed output layer has no way to say "not one of mine".
#
# `sorted()` for a stable order; `dict.fromkeys` dedupes while preserving that
# order, since several classes share a crop.
# ---------------------------------------------------------------------------
DIAGNOSABLE_CROPS: tuple[str, ...] = tuple(
    dict.fromkeys(sorted(c.crop_type for c in DISEASE_CLASSES))
)


def is_diagnosable_crop(crop: str) -> bool:
    """True when `crop` is one this model was trained to recognise.

    Case-insensitive, because the value may come from a free-text field
    (`users.primary_crops`) rather than a picker.
    """
    needle = crop.strip().casefold()
    return any(c.casefold() == needle for c in DIAGNOSABLE_CROPS)


def diseases_for_crop(crop: str) -> list[DiseaseClass]:
    """Every class this model can return for `crop`, in taxonomy order."""
    needle = crop.strip().casefold()
    return [c for c in DISEASE_CLASSES if c.crop_type.casefold() == needle]
