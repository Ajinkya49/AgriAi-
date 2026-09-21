"""Minimal logging setup shared by every backend module."""

from __future__ import annotations

import logging
import sys

_CONFIGURED = False


def configure_logging(environment: str = "development") -> None:
    """Configure root logging once, with a level appropriate to the environment."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    level = logging.DEBUG if environment == "development" else logging.INFO
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)-8s | %(name)s | %(message)s")
    )

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Third-party libraries are extremely chatty at DEBUG — httpx/httpcore/hpack
    # alone emit hundreds of lines per request, which buries our own output.
    # Keep only their warnings and above.
    for noisy in ("httpx", "httpcore", "hpack", "h2", "urllib3", "watchfiles"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Return a module-level logger."""
    return logging.getLogger(name)
