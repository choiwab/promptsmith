from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from backend.app.storage.repository import Repository
from backend.app.storage.schemas import ProjectRecord

router = APIRouter(tags=["projects"])


class UpsertProjectRequest(BaseModel):
    project_id: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1)


class ProjectResponse(BaseModel):
    project_id: str
    name: str
    active_baseline_commit_id: str | None = None
    created_at: str
    updated_at: str


class UpsertProjectResponse(ProjectResponse):
    created: bool


class ListProjectsResponse(BaseModel):
    items: list[ProjectResponse]


class DeleteProjectResponse(BaseModel):
    project_id: str
    deleted_image_objects: int


def _to_project_response(project: ProjectRecord) -> ProjectResponse:
    return ProjectResponse(
        project_id=project.project_id,
        name=project.name,
        active_baseline_commit_id=project.active_baseline_commit_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.get("/projects", response_model=ListProjectsResponse)
async def list_projects(request: Request) -> ListProjectsResponse:
    repository: Repository = request.app.state.repository
    projects = repository.list_projects()
    return ListProjectsResponse(items=[_to_project_response(project) for project in projects])


@router.post("/projects", response_model=UpsertProjectResponse)
async def upsert_project(payload: UpsertProjectRequest, request: Request) -> UpsertProjectResponse:
    repository: Repository = request.app.state.repository
    project, created = repository.upsert_project(payload.project_id, payload.name)
    return UpsertProjectResponse(
        project_id=project.project_id,
        name=project.name,
        active_baseline_commit_id=project.active_baseline_commit_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
        created=created,
    )


@router.delete("/projects/{project_id}", response_model=DeleteProjectResponse)
async def delete_project(project_id: str, request: Request) -> DeleteProjectResponse:
    repository: Repository = request.app.state.repository
    result = repository.delete_project(project_id)
    deleted_image_objects_raw = result.get("deleted_image_objects", 0)
    deleted_image_objects = deleted_image_objects_raw if isinstance(deleted_image_objects_raw, int) else 0
    return DeleteProjectResponse(
        project_id=str(result.get("project_id", project_id)),
        deleted_image_objects=deleted_image_objects,
    )
