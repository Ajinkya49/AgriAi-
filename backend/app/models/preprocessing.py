"""Image validation and preprocessing (Pillow).

The TRD requires three things before inference:
  1. validate the file type and size,
  2. fix EXIF orientation from mobile camera uploads,
  3. resize and normalise to the model's expected input.

Kept free of any torch import so it can be unit-tested without loading the model.
Returns a float32 CHW array; `inference.py` wraps it in a tensor.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.models.labels import IMAGENET_MEAN, IMAGENET_STD, INPUT_SIZE

# Must stay in step with the storage bucket's allowed_mime_types.
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

# Matches the bucket's file_size_limit (10 MB).
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# A leaf photo smaller than this cannot carry enough detail to classify.
MIN_DIMENSION = 64

# Guard against decompression bombs (a tiny file that expands to a huge image).
MAX_PIXELS = 50_000_000


class ImageValidationError(ValueError):
    """The upload is not a usable crop photo. Message is safe to show a farmer."""


@dataclass(frozen=True)
class PreparedImage:
    """A validated image, ready for the model."""

    array: np.ndarray  # float32, shape (3, INPUT_SIZE, INPUT_SIZE)
    width: int
    height: int
    original_format: str


def _load(raw: bytes) -> Image.Image:
    """Open and validate the bytes, without decoding more than necessary."""
    if not raw:
        raise ImageValidationError("That file was empty. Please choose a photo and try again.")

    if len(raw) > MAX_UPLOAD_BYTES:
        limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise ImageValidationError(
            f"That photo is larger than {limit_mb} MB. Please choose a smaller one."
        )

    try:
        # Image.open is lazy — force a load so malformed files fail here.
        image = Image.open(io.BytesIO(raw))
        image.load()
    except UnidentifiedImageError as exc:
        raise ImageValidationError(
            "That file is not an image we can read. Please use a JPG, PNG or WEBP photo."
        ) from exc
    except (OSError, ValueError) as exc:
        raise ImageValidationError(
            "That image appears to be damaged. Please try another photo."
        ) from exc

    if image.format not in ALLOWED_FORMATS:
        allowed = ", ".join(sorted(ALLOWED_FORMATS))
        raise ImageValidationError(
            f"That image format is not supported. Please use one of: {allowed}."
        )

    if image.width * image.height > MAX_PIXELS:
        raise ImageValidationError("That image is too large to process. Please try another photo.")

    return image


def prepare_image(raw: bytes) -> PreparedImage:
    """Validate, orient, resize and normalise an uploaded crop photo.

    Raises `ImageValidationError` with a farmer-readable message on any problem.
    """
    image = _load(raw)
    # Capture the format now — PIL drops it once the image is transformed.
    original_format = image.format or "UNKNOWN"

    # Mobile cameras record orientation in EXIF rather than rotating pixels, so a
    # portrait photo arrives as landscape-with-a-flag. Without this, leaves come
    # out sideways and the model sees a rotated plant.
    image = ImageOps.exif_transpose(image) or image

    if image.mode != "RGB":
        image = image.convert("RGB")

    width, height = image.size
    if min(width, height) < MIN_DIMENSION:
        raise ImageValidationError(
            "That photo is too small to analyse. Please take a closer photo of the leaf."
        )

    # Resize the shorter side to 224, then centre-crop — preserves aspect ratio
    # and avoids the distortion a plain resize would introduce.
    image = ImageOps.fit(image, (INPUT_SIZE, INPUT_SIZE), method=Image.Resampling.BICUBIC)

    array = np.asarray(image, dtype=np.float32) / 255.0
    mean = np.asarray(IMAGENET_MEAN, dtype=np.float32)
    std = np.asarray(IMAGENET_STD, dtype=np.float32)
    array = (array - mean) / std

    # HWC -> CHW, which is what PyTorch convolutions expect.
    array = np.transpose(array, (2, 0, 1))
    array = np.ascontiguousarray(array)

    return PreparedImage(
        array=array,
        width=width,
        height=height,
        original_format=original_format,
    )
