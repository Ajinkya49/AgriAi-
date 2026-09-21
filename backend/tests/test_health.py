"""Phase 1 smoke tests: the API boots and its placeholder endpoints respond."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_responds() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_responds() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "Agri AI API"


def test_dependency_health_reports_shape() -> None:
    response = client.get("/api/health/dependencies")
    assert response.status_code == 200
    body = response.json()
    # Supabase may or may not be configured locally; the shape must still hold.
    assert "configured" in body["supabase"]
    assert body["model"]["loaded"] is False
    assert body["rag"]["loaded"] is False
