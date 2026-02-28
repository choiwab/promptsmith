from __future__ import annotations

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from backend.app.storage.repository import Repository

router = APIRouter(tags=["commits"])


class DeleteCommitResponse(BaseModel):
    project_id: str
    deleted_commit_ids: list[str] = Field(default_factory=list)
    deleted_report_ids: list[str] = Field(default_factory=list)
    deleted_image_objects: int = 0
    active_baseline_commit_id: str | None = None


@router.delete("/commits/{commit_id}", response_model=DeleteCommitResponse)
async def delete_commit_subtree(
    commit_id: str,
    request: Request,
    project_id: str = Query(min_length=1),
) -> DeleteCommitResponse:
    repository: Repository = request.app.state.repository
    result = repository.delete_commit_subtree(project_id=project_id, commit_id=commit_id)
    deleted_commit_ids_raw = result.get("deleted_commit_ids", [])
    deleted_report_ids_raw = result.get("deleted_report_ids", [])
    deleted_image_objects_raw = result.get("deleted_image_objects", 0)
    active_baseline_raw = result.get("active_baseline_commit_id")

    deleted_commit_ids = [str(value) for value in deleted_commit_ids_raw] if isinstance(deleted_commit_ids_raw, list) else []
    deleted_report_ids = [str(value) for value in deleted_report_ids_raw] if isinstance(deleted_report_ids_raw, list) else []
    deleted_image_objects = int(deleted_image_objects_raw) if isinstance(deleted_image_objects_raw, (int, float, str)) else 0
    active_baseline_commit_id = active_baseline_raw if isinstance(active_baseline_raw, str) else None

    return DeleteCommitResponse(
        project_id=project_id,
        deleted_commit_ids=deleted_commit_ids,
        deleted_report_ids=deleted_report_ids,
        deleted_image_objects=deleted_image_objects,
        active_baseline_commit_id=active_baseline_commit_id,
    )
