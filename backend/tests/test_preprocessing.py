"""Phase 4 — image validation and preprocessing tests.

These deliberately do not require torch: `preprocessing.py` returns a numpy array
so the validation logic stays testable without loading a model.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from app.models.labels import INPUT_SIZE
from app.models.preprocessing import (
    MAX_UPLOAD_BYTES,
    ImageValidationError,
    prepare_image,
)


def make_image(width: int = 300, height: int = 200, fmt: str = "JPEG") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (60, 120, 60)).save(buffer, format=fmt)
    return buffer.getvalue()


def test_valid_jpeg_is_prepared() -> None:
    prepared = prepare_image(make_image())
    assert prepared.array.shape == (3, INPUT_SIZE, INPUT_SIZE)
    assert prepared.array.dtype == np.float32
    assert prepared.original_format == "JPEG"


def test_valid_png_is_prepared() -> None:
    prepared = prepare_image(make_image(fmt="PNG"))
    assert prepared.array.shape == (3, INPUT_SIZE, INPUT_SIZE)
    assert prepared.original_format == "PNG"


def test_non_image_bytes_are_rejected() -> None:
    with pytest.raises(ImageValidationError, match="not an image"):
        prepare_image(b"this is definitely not a photo")


def test_empty_upload_is_rejected() -> None:
    with pytest.raises(ImageValidationError, match="empty"):
        prepare_image(b"")


def test_oversized_upload_is_rejected() -> None:
    # A real JPEG header followed by padding past the 10 MB cap.
    oversized = make_image() + b"\x00" * (MAX_UPLOAD_BYTES + 1)
    with pytest.raises(ImageValidationError, match="larger than"):
        prepare_image(oversized)


def test_tiny_image_is_rejected() -> None:
    with pytest.raises(ImageValidationError, match="too small"):
        prepare_image(make_image(width=32, height=32))


def test_unsupported_format_is_rejected() -> None:
    buffer = io.BytesIO()
    Image.new("RGB", (300, 200), (10, 10, 10)).save(buffer, format="BMP")
    with pytest.raises(ImageValidationError, match="not supported"):
        prepare_image(buffer.getvalue())


def test_exif_orientation_is_applied() -> None:
    """A portrait photo from a phone arrives landscape-with-an-EXIF-flag.

    Orientation 6 means "rotate 90 degrees clockwise on display", so a 200x100
    stored image should be reported as 100x200 once the tag is honoured.
    """
    buffer = io.BytesIO()
    image = Image.new("RGB", (200, 100), (200, 30, 30))
    exif = Image.Exif()
    exif[274] = 6  # Orientation
    image.save(buffer, format="JPEG", exif=exif)

    prepared = prepare_image(buffer.getvalue())
    assert (prepared.width, prepared.height) == (100, 200), "EXIF orientation was not applied"


def test_grayscale_is_converted_to_three_channels() -> None:
    buffer = io.BytesIO()
    Image.new("L", (300, 200), 128).save(buffer, format="PNG")
    prepared = prepare_image(buffer.getvalue())
    assert prepared.array.shape == (3, INPUT_SIZE, INPUT_SIZE)


def test_output_is_normalised() -> None:
    """Values should be roughly zero-centred after ImageNet normalisation."""
    prepared = prepare_image(make_image())
    # A flat mid-green image normalises to a small, finite range.
    assert np.isfinite(prepared.array).all()
    assert abs(float(prepared.array.mean())) < 5.0
