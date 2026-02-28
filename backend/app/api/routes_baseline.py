from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from backend.app.storage.repository import Repository

router = APIRouter(tags=["baseline"])


class BaselineRequest(BaseModel):
    project_id: str = Field(min_length=1)
    commit_id: str = Field(min_length=1)


class BaselineResponse(BaseModel):
    project_id: str
    active_baseline_commit_id: str
    updated_at: str


@router.post("/baseline", response_model=BaselineResponse)
async def set_baseline(payload: BaselineRequest, request: Request) -> BaselineResponse:
    repository: Repository = request.app.state.repository
    repository.ensure_project(payload.project_id)
    project = repository.set_baseline(
        project_id=payload.project_id,
        commit_id=payload.commit_id,
    )
    return BaselineResponse(
        project_id=project.project_id,
        active_baseline_commit_id=project.active_baseline_commit_id or "",
        updated_at=project.updated_at,
    )
