from __future__ import annotations

import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.app.api.routes_history import history as history_route
from backend.app.core.config import Settings
from backend.app.services.compare_orchestrator import CompareOrchestrator
from backend.app.storage.repository import Repository
from backend.app.storage.schemas import CommitRecord, ComparisonReportRecord, ProjectRecord


def make_settings(tmp_path: Path) -> Settings:
    return Settings(
        openai_api_key=None,
        openai_image_model="gpt-image-1",
        openai_text_model="gpt-4.1-mini",
        openai_vision_model="gpt-4.1-mini",
        app_data_dir=tmp_path,
        app_image_dir=tmp_path / "images",
        app_artifact_dir=tmp_path / "artifacts",
        app_compare_threshold=0.30,
        openai_timeout_seconds=30.0,
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-key",
        supabase_storage_bucket="promptsmith-images",
        supabase_table_prefix="promptsmith_",
        supabase_schema="public",
    )


class _PixelResult:
    def __init__(self, score: float = 0.2):
        self.pixel_diff_score = score
        self.diff_heatmap_path = "artifacts/diff.png"
        self.overlay_path = "artifacts/overlay.png"


class _PixelService:
    def compare(self, **_: object) -> _PixelResult:
        return _PixelResult()


class _SemanticService:
    async def evaluate(self, **_: object) -> float:
        return 0.9


class _VisionService:
    async def evaluate(self, **_: object) -> dict[str, object]:
        return {
            "facial_structure_changed": False,
            "lighting_shift": "low",
            "style_drift": "low",
            "notes": "stable",
            "vision_structural_score": 0.1,
        }


class _CompareRepo:
    def __init__(self, baseline_id: str, commits: dict[str, CommitRecord]):
        self._project = ProjectRecord(
            project_id="default",
            name="default",
            active_baseline_commit_id=baseline_id,
            created_at="2026-02-01T00:00:00Z",
            updated_at="2026-02-01T00:00:00Z",
        )
        self._commits = commits
        self.saved_report: ComparisonReportRecord | None = None

    def get_project(self, _: str) -> ProjectRecord:
        return self._project

    def get_commit(self, commit_id: str, project_id: str | None = None) -> CommitRecord:
        del project_id
        return self._commits[commit_id]

    def reserve_report_id(self) -> str:
        return "r001"

    def get_config(self):
        return SimpleNamespace(threshold=0.30)

    def create_comparison_report(self, report: ComparisonReportRecord) -> ComparisonReportRecord:
        self.saved_report = report
        return report


@pytest.mark.asyncio
async def test_compare_override_uses_explicit_baseline(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.png"
    candidate = tmp_path / "candidate.png"
    baseline.write_bytes(b"baseline")
    candidate.write_bytes(b"candidate")

    commits = {
        "c_baseline_default": CommitRecord(
            commit_id="c_baseline_default",
            project_id="default",
            prompt="default baseline",
            model="gpt-image-1",
            seed=None,
            parent_commit_id=None,
            image_paths=[str(baseline)],
            status="success",
            error=None,
            created_at="2026-02-01T00:00:00Z",
        ),
        "c_baseline_explicit": CommitRecord(
            commit_id="c_baseline_explicit",
            project_id="default",
            prompt="explicit baseline",
            model="gpt-image-1",
            seed=None,
            parent_commit_id=None,
            image_paths=[str(baseline)],
            status="success",
            error=None,
            created_at="2026-02-02T00:00:00Z",
        ),
        "c_candidate": CommitRecord(
            commit_id="c_candidate",
            project_id="default",
            prompt="candidate",
            model="gpt-image-1",
            seed=None,
            parent_commit_id="c_baseline_explicit",
            image_paths=[str(candidate)],
            status="success",
            error=None,
            created_at="2026-02-03T00:00:00Z",
        ),
    }
    repo = _CompareRepo("c_baseline_default", commits)
    orchestrator = CompareOrchestrator(
        settings=make_settings(tmp_path),
        repository=repo,  # type: ignore[arg-type]
        pixel_service=_PixelService(),
        semantic_service=_SemanticService(),  # type: ignore[arg-type]
        vision_service=_VisionService(),  # type: ignore[arg-type]
    )

    explicit = await orchestrator.compare(
        project_id="default",
        baseline_commit_id="c_baseline_explicit",
        candidate_commit_id="c_candidate",
    )
    fallback = await orchestrator.compare(
        project_id="default",
        candidate_commit_id="c_candidate",
    )

    assert explicit.baseline_commit_id == "c_baseline_explicit"
    assert fallback.baseline_commit_id == "c_baseline_default"


class _DeleteMirror:
    def __init__(self, commits: list[dict[str, object]], comparisons: list[dict[str, object]]):
        self._commits = commits
        self._comparisons = comparisons
        self.deleted_commit_ids: list[str] = []
        self.deleted_report_ids: list[str] = []

    def get_project(self, _: str) -> dict[str, object]:
        return {
            "project_id": "default",
            "name": "default",
            "active_baseline_commit_id": "c2",
            "created_at": "2026-02-01T00:00:00Z",
            "updated_at": "2026-02-01T00:00:00Z",
        }

    def get_commit(self, commit_id: str) -> dict[str, object] | None:
        for commit in self._commits:
            if commit["commit_id"] == commit_id:
                return commit
        return None

    def list_commits(self, _: str) -> list[dict[str, object]]:
        return self._commits

    def list_comparisons(self, _: str) -> list[dict[str, object]]:
        return self._comparisons

    def delete_comparisons(self, report_ids: list[str]) -> list[dict[str, object]]:
        self.deleted_report_ids = sorted(report_ids)
        return [{"report_id": value} for value in report_ids]

    def delete_commits(self, commit_ids: list[str]) -> list[dict[str, object]]:
        self.deleted_commit_ids = sorted(commit_ids)
        return [{"commit_id": value} for value in commit_ids]

    def update_project(self, project_id: str, payload: dict[str, object]) -> dict[str, object]:
        return {
            "project_id": project_id,
            "name": "default",
            "active_baseline_commit_id": payload.get("active_baseline_commit_id"),
            "created_at": "2026-02-01T00:00:00Z",
            "updated_at": payload.get("updated_at", "2026-02-01T00:00:00Z"),
        }

    def delete_storage_object(self, _: str) -> bool:
        return True


def _make_repository_for_delete(tmp_path: Path) -> Repository:
    local_image = tmp_path / "commit.png"
    local_image.write_bytes(b"image")

    commits = [
        {
            "commit_id": "c1",
            "project_id": "default",
            "prompt": "root",
            "model": "gpt-image-1",
            "seed": None,
            "parent_commit_id": None,
            "image_paths": [str(local_image)],
            "status": "success",
            "error": None,
            "created_at": "2026-02-01T00:00:00Z",
        },
        {
            "commit_id": "c2",
            "project_id": "default",
            "prompt": "child",
            "model": "gpt-image-1",
            "seed": None,
            "parent_commit_id": "c1",
            "image_paths": [],
            "status": "success",
            "error": None,
            "created_at": "2026-02-02T00:00:00Z",
        },
        {
            "commit_id": "c3",
            "project_id": "default",
            "prompt": "grandchild",
            "model": "gpt-image-1",
            "seed": None,
            "parent_commit_id": "c2",
            "image_paths": [],
            "status": "success",
            "error": None,
            "created_at": "2026-02-03T00:00:00Z",
        },
    ]
    comparisons = [
        {
            "report_id": "r1",
            "project_id": "default",
            "baseline_commit_id": "c2",
            "candidate_commit_id": "c3",
            "pixel_diff_score": 0.1,
            "semantic_similarity": 0.9,
            "vision_structural_score": 0.1,
            "drift_score": 0.1,
            "threshold": 0.3,
            "verdict": "pass",
            "degraded": False,
            "explanation": {},
            "artifacts": {},
            "created_at": "2026-02-03T00:00:00Z",
        }
    ]

    mirror = _DeleteMirror(commits, comparisons)
    repository = object.__new__(Repository)
    repository.settings = make_settings(tmp_path)
    repository.store = SimpleNamespace()
    repository._lock = threading.Lock()
    repository.supabase_mirror = mirror
    return repository


def test_delete_subtree_cascades_and_clears_baseline(tmp_path: Path) -> None:
    repository = _make_repository_for_delete(tmp_path)
    result = repository.delete_commit_subtree(project_id="default", commit_id="c2")

    assert result["deleted_commit_ids"] == ["c2", "c3"]
    assert result["deleted_report_ids"] == ["r1"]
    assert result["active_baseline_commit_id"] is None
    assert result["deleted_image_objects"] == 0


@pytest.mark.asyncio
async def test_history_route_includes_enriched_fields() -> None:
    commit = CommitRecord(
        commit_id="c100",
        project_id="default",
        prompt="test prompt",
        model="gpt-image-1",
        seed="1234",
        parent_commit_id=None,
        image_paths=["/images/c100/img_01.png"],
        status="failed",
        error="generation failed",
        created_at="2026-02-15T00:00:00Z",
    )
    repository = SimpleNamespace(
        get_project=lambda _project_id: ProjectRecord(
            project_id="default",
            name="default",
            active_baseline_commit_id="c090",
            created_at="2026-02-01T00:00:00Z",
            updated_at="2026-02-01T00:00:00Z",
        ),
        list_history=lambda **_: ([commit], None),
    )
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(repository=repository)))

    response = await history_route(request=request, project_id="default", limit=20, cursor=None)

    assert response.items[0].model == "gpt-image-1"
    assert response.items[0].seed == "1234"
    assert response.items[0].error == "generation failed"
