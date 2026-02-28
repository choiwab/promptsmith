from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


def utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class ProjectRecord(BaseModel):
    project_id: str
    name: str
    active_baseline_commit_id: str | None = None
    created_at: str
    updated_at: str


class CommitRecord(BaseModel):
    commit_id: str
    project_id: str
    prompt: str
    model: str
    seed: str | None = None
    parent_commit_id: str | None = None
    image_paths: list[str] = Field(default_factory=list)
    status: Literal["success", "failed"]
    error: str | None = None
    created_at: str


class ComparisonReportRecord(BaseModel):
    report_id: str
    project_id: str
    baseline_commit_id: str
    candidate_commit_id: str
    pixel_diff_score: float
    semantic_similarity: float
    vision_structural_score: float
    drift_score: float
    threshold: float
    verdict: Literal["pass", "fail", "inconclusive"]
    degraded: bool
    explanation: dict[str, Any]
    artifacts: dict[str, str]
    created_at: str


class ConfigRecord(BaseModel):
    weights: dict[str, float] = Field(
        default_factory=lambda: {
            "semantic": 0.40,
            "pixel": 0.30,
            "vision": 0.30,
        }
    )
    threshold: float = 0.30
    image_size: str = "1024x1024"
    max_daily_compares: int = 500
    next_commit_number: int = 1
    next_report_number: int = 1
