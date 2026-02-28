from __future__ import annotations

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from backend.app.storage.repository import Repository

router = APIRouter(tags=["history"])


class HistoryItem(BaseModel):
    commit_id: str
    prompt: str
    parent_commit_id: str | None = None
    image_paths: list[str] = Field(default_factory=list)
    status: str
    created_at: str


class HistoryResponse(BaseModel):
    items: list[HistoryItem]
    next_cursor: str | None = None
    active_baseline_commit_id: str | None = None


@router.get("/history", response_model=HistoryResponse)
async def history(
    request: Request,
    project_id: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = Query(default=None),
) -> HistoryResponse:
    repository: Repository = request.app.state.repository
    project = repository.get_project(project_id)
    commits, next_cursor = repository.list_history(
        project_id=project_id,
        limit=limit,
        cursor=cursor,
    )
    return HistoryResponse(
        items=[
            HistoryItem(
                commit_id=commit.commit_id,
                prompt=commit.prompt,
                parent_commit_id=commit.parent_commit_id,
                image_paths=commit.image_paths,
                status=commit.status,
                created_at=commit.created_at,
            )
            for commit in commits
        ],
        next_cursor=next_cursor,
        active_baseline_commit_id=project.active_baseline_commit_id,
    )
