from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Literal

from backend.app.core.config import Settings
from backend.app.core.errors import ApiError, ErrorCode
from backend.app.storage.file_store import FileStore
from backend.app.storage.schemas import (
    CommitRecord,
    ComparisonReportRecord,
    ConfigRecord,
    ProjectRecord,
    utc_now_iso,
)
from backend.app.storage.supabase_mirror import SupabaseMirror


def _model_validate(model_cls, payload):
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(payload)
    return model_cls.parse_obj(payload)


def _model_dump(instance):
    if hasattr(instance, "model_dump"):
        return instance.model_dump()
    return instance.dict()


class Repository:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = FileStore()
        self._lock = threading.Lock()
        if not settings.supabase_enabled:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Local JSON storage is disabled."
            )
        self.supabase_mirror = SupabaseMirror(settings)

    def reset_storage(self) -> None:
        with self._lock:
            self._safe_call("clear comparisons", self.supabase_mirror.delete_all_records, "comparisons", "report_id")
            self._safe_call("clear commits", self.supabase_mirror.delete_all_records, "commits", "commit_id")
            self._safe_call("clear projects", self.supabase_mirror.delete_all_records, "projects", "project_id")

    def list_projects(self) -> list[ProjectRecord]:
        payload = self._safe_call("list projects", self.supabase_mirror.list_projects)
        projects = [_model_validate(ProjectRecord, item) for item in payload]
        projects.sort(key=lambda item: item.updated_at, reverse=True)
        return projects

    def get_config(self) -> ConfigRecord:
        return ConfigRecord(threshold=self.settings.app_compare_threshold)

    def reserve_commit_id(self) -> str:
        return f"c{uuid.uuid4().hex[:12]}"

    def reserve_report_id(self) -> str:
        return f"r{uuid.uuid4().hex[:12]}"

    def upsert_project(self, project_id: str, name: str | None = None) -> tuple[ProjectRecord, bool]:
        with self._lock:
            existing_payload = self._safe_call("fetch project", self.supabase_mirror.get_project, project_id)
            if existing_payload:
                existing = _model_validate(ProjectRecord, existing_payload)
                if name and name != existing.name:
                    existing.name = name
                    existing.updated_at = utc_now_iso()
                    updated_payload = self._safe_call(
                        "update project",
                        self.supabase_mirror.update_project,
                        project_id,
                        {
                            "name": existing.name,
                            "updated_at": existing.updated_at,
                        },
                    )
                    if updated_payload:
                        existing = _model_validate(ProjectRecord, updated_payload)
                return existing, False

            now = utc_now_iso()
            project = ProjectRecord(
                project_id=project_id,
                name=name or project_id,
                active_baseline_commit_id=None,
                created_at=now,
                updated_at=now,
            )
            payload = self._safe_call("insert project", self.supabase_mirror.insert_project, _model_dump(project))
            return _model_validate(ProjectRecord, payload), True

    def ensure_project(self, project_id: str, name: str | None = None) -> ProjectRecord:
        project, _ = self.upsert_project(project_id, name)
        return project

    def get_project(self, project_id: str) -> ProjectRecord:
        payload = self._safe_call("fetch project", self.supabase_mirror.get_project, project_id)
        if payload is None:
            raise ApiError(
                ErrorCode.PROJECT_NOT_FOUND,
                f"Project '{project_id}' was not found.",
                status_code=404,
            )
        return _model_validate(ProjectRecord, payload)

    def create_commit(
        self,
        *,
        commit_id: str,
        project_id: str,
        prompt: str,
        model: str,
        seed: str | None,
        parent_commit_id: str | None,
        image_paths: list[str],
        status: Literal["success", "failed"],
        error: str | None,
    ) -> CommitRecord:
        with self._lock:
            commit = CommitRecord(
                commit_id=commit_id,
                project_id=project_id,
                prompt=prompt,
                model=model,
                seed=seed,
                parent_commit_id=parent_commit_id,
                image_paths=image_paths,
                status=status,
                error=error,
                created_at=utc_now_iso(),
            )
            payload = self._safe_call("insert commit", self.supabase_mirror.insert_commit, _model_dump(commit))
            return _model_validate(CommitRecord, payload)

    def get_commit(self, commit_id: str, project_id: str | None = None) -> CommitRecord:
        payload = self._safe_call("fetch commit", self.supabase_mirror.get_commit, commit_id)
        if payload is None:
            raise ApiError(
                ErrorCode.COMMIT_NOT_FOUND,
                f"Commit '{commit_id}' was not found.",
                status_code=404,
            )
        commit = _model_validate(CommitRecord, payload)
        if project_id is not None and commit.project_id != project_id:
            raise ApiError(
                ErrorCode.COMMIT_NOT_FOUND,
                f"Commit '{commit_id}' was not found in project '{project_id}'.",
                status_code=404,
            )
        return commit

    def set_baseline(self, project_id: str, commit_id: str) -> ProjectRecord:
        with self._lock:
            self.get_project(project_id)
            commit = self.get_commit(commit_id, project_id=project_id)
            if commit.status != "success":
                raise ApiError(
                    ErrorCode.COMMIT_NOT_FOUND,
                    f"Commit '{commit_id}' is not a successful generation.",
                    status_code=404,
                )

            now = utc_now_iso()
            payload = self._safe_call(
                "set project baseline",
                self.supabase_mirror.update_project,
                project_id,
                {
                    "active_baseline_commit_id": commit_id,
                    "updated_at": now,
                },
            )
            if payload is None:
                raise ApiError(
                    ErrorCode.PROJECT_NOT_FOUND,
                    f"Project '{project_id}' was not found.",
                    status_code=404,
                )
            return _model_validate(ProjectRecord, payload)

    def list_history(self, project_id: str, limit: int, cursor: str | None) -> tuple[list[CommitRecord], str | None]:
        self.get_project(project_id)
        payload = self._safe_call("list commits", self.supabase_mirror.list_commits, project_id)
        commits = [self._parse_commit(item) for item in payload]
        commits.sort(key=lambda c: (c.created_at, c.commit_id), reverse=True)

        start_index = 0
        if cursor:
            cursor_index = next((idx for idx, c in enumerate(commits) if c.commit_id == cursor), None)
            if cursor_index is not None:
                start_index = cursor_index + 1

        page_items = commits[start_index : start_index + limit]
        has_more = start_index + limit < len(commits)
        next_cursor = page_items[-1].commit_id if has_more and page_items else None
        return page_items, next_cursor

    def create_comparison_report(self, report: ComparisonReportRecord) -> ComparisonReportRecord:
        with self._lock:
            payload = self._safe_call("insert comparison", self.supabase_mirror.insert_comparison, _model_dump(report))
            return _model_validate(ComparisonReportRecord, payload)

    def delete_commit_subtree(self, *, project_id: str, commit_id: str) -> dict[str, object]:
        with self._lock:
            project = self.get_project(project_id)
            self.get_commit(commit_id, project_id=project_id)

            commit_payloads = self._safe_call("list commits", self.supabase_mirror.list_commits, project_id)
            commits = [self._parse_commit(item) for item in commit_payloads]
            by_id = {item.commit_id: item for item in commits}

            children_by_parent: dict[str, list[str]] = {}
            for item in commits:
                if not item.parent_commit_id:
                    continue
                children_by_parent.setdefault(item.parent_commit_id, []).append(item.commit_id)

            to_delete: set[str] = set()
            queue = [commit_id]
            while queue:
                current = queue.pop(0)
                if current in to_delete:
                    continue
                to_delete.add(current)
                queue.extend(children_by_parent.get(current, []))

            deleted_commit_ids = sorted(to_delete)
            image_paths: list[str] = []
            for deleted_id in deleted_commit_ids:
                commit = by_id.get(deleted_id)
                if commit:
                    image_paths.extend(commit.image_paths)

            comparison_payloads = self._safe_call("list comparisons", self.supabase_mirror.list_comparisons, project_id)
            report_ids_to_delete: list[str] = []
            for raw in comparison_payloads:
                report = _model_validate(ComparisonReportRecord, raw)
                if report.baseline_commit_id in to_delete or report.candidate_commit_id in to_delete:
                    report_ids_to_delete.append(report.report_id)

            if report_ids_to_delete:
                self._safe_call("delete comparisons", self.supabase_mirror.delete_comparisons, report_ids_to_delete)
            self._safe_call("delete commits", self.supabase_mirror.delete_commits, deleted_commit_ids)

            artifact_delete_count = 0
            for path in image_paths:
                if self._delete_local_artifact(path):
                    artifact_delete_count += 1
                    continue
                object_path = self._extract_storage_object_path(path)
                if object_path:
                    try:
                        if self.supabase_mirror.delete_storage_object(object_path):
                            artifact_delete_count += 1
                    except Exception:
                        # Keep delete best-effort for artifact cleanup.
                        pass

            active_baseline_commit_id = project.active_baseline_commit_id
            if active_baseline_commit_id and active_baseline_commit_id in to_delete:
                now = utc_now_iso()
                updated = self._safe_call(
                    "clear project baseline",
                    self.supabase_mirror.update_project,
                    project_id,
                    {
                        "active_baseline_commit_id": None,
                        "updated_at": now,
                    },
                )
                if updated:
                    active_baseline_commit_id = _model_validate(ProjectRecord, updated).active_baseline_commit_id
                else:
                    active_baseline_commit_id = None

            return {
                "deleted_commit_ids": deleted_commit_ids,
                "deleted_report_ids": sorted(report_ids_to_delete),
                "deleted_image_objects": artifact_delete_count,
                "active_baseline_commit_id": active_baseline_commit_id,
            }

    def upload_commit_image(self, *, commit_id: str, filename: str, payload: bytes) -> str:
        return self._safe_call(
            "upload commit image",
            self.supabase_mirror.upload_commit_image,
            commit_id=commit_id,
            filename=filename,
            payload=payload,
        )

    def _parse_commit(self, payload: dict) -> CommitRecord:
        return _model_validate(CommitRecord, payload)

    def _extract_storage_object_path(self, image_path: str) -> str | None:
        token = f"/storage/v1/object/public/{self.settings.supabase_storage_bucket}/"
        index = image_path.find(token)
        if index == -1:
            return None
        object_path = image_path[index + len(token) :].strip("/")
        return object_path or None

    def _delete_local_artifact(self, image_path: str) -> bool:
        try:
            path = Path(image_path)
            if not path.is_absolute():
                path = (Path.cwd() / path).resolve()
            if path.exists():
                path.unlink()
                return True
        except Exception:
            return False
        return False

    def _safe_call(self, operation: str, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ApiError:
            raise
        except Exception as exc:
            raise ApiError(
                ErrorCode.STORAGE_WRITE_FAILED,
                f"Failed to {operation}: {exc}",
                status_code=500,
            ) from exc
