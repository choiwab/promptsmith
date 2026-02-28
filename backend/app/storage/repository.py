from __future__ import annotations

import logging
import threading
from pathlib import Path

from backend.app.core.config import Settings
from backend.app.core.errors import ApiError, ErrorCode
from backend.app.storage.file_store import FileStore
from backend.app.storage.id_factory import format_id, parse_id_number
from backend.app.storage.schemas import (
    CommitRecord,
    ComparisonReportRecord,
    ConfigRecord,
    ProjectRecord,
    utc_now_iso,
)
from backend.app.storage.supabase_mirror import SupabaseMirror

logger = logging.getLogger("promptsmith.backend")


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
        self.supabase_mirror = SupabaseMirror(settings) if settings.supabase_enabled else None

        self.projects_path = self.settings.app_data_dir / "projects.json"
        self.commits_path = self.settings.app_data_dir / "commits.json"
        self.comparisons_path = self.settings.app_data_dir / "comparisons.json"
        self.config_path = self.settings.app_data_dir / "config.json"

        self._bootstrap()

    def _bootstrap(self) -> None:
        self.settings.ensure_directories()
        # Local JSON storage remains the baseline source of truth and cache.
        # Optional Supabase sync mirrors entities for remote durability.
        if not self.projects_path.exists():
            self.store.atomic_write_json(self.projects_path, {"items": []})
        if not self.commits_path.exists():
            self.store.atomic_write_json(self.commits_path, {"items": []})
        if not self.comparisons_path.exists():
            self.store.atomic_write_json(self.comparisons_path, {"items": []})
        if not self.config_path.exists():
            config = ConfigRecord(threshold=self.settings.app_compare_threshold)
            self.store.atomic_write_json(self.config_path, _model_dump(config))

    def reset_storage(self) -> None:
        with self._lock:
            self.store.atomic_write_json(self.projects_path, {"items": []})
            self.store.atomic_write_json(self.commits_path, {"items": []})
            self.store.atomic_write_json(self.comparisons_path, {"items": []})
            config = ConfigRecord(threshold=self.settings.app_compare_threshold)
            self.store.atomic_write_json(self.config_path, _model_dump(config))

    def _read_collection(self, path: Path):
        payload = self.store.read_json(path, {"items": []})
        items = payload.get("items", [])
        if not isinstance(items, list):
            return []
        return items

    def _write_collection(self, path: Path, items: list[dict]) -> None:
        self.store.atomic_write_json(path, {"items": items})

    def _load_projects(self) -> list[ProjectRecord]:
        return [_model_validate(ProjectRecord, i) for i in self._read_collection(self.projects_path)]

    def _save_projects(self, items: list[ProjectRecord]) -> None:
        self._write_collection(self.projects_path, [_model_dump(i) for i in items])

    def list_projects(self) -> list[ProjectRecord]:
        projects = self._load_projects()
        projects.sort(key=lambda item: item.updated_at, reverse=True)
        return projects

    def _load_commits(self) -> list[CommitRecord]:
        return [_model_validate(CommitRecord, i) for i in self._read_collection(self.commits_path)]

    def _save_commits(self, items: list[CommitRecord]) -> None:
        self._write_collection(self.commits_path, [_model_dump(i) for i in items])

    def _load_comparisons(self) -> list[ComparisonReportRecord]:
        return [_model_validate(ComparisonReportRecord, i) for i in self._read_collection(self.comparisons_path)]

    def _save_comparisons(self, items: list[ComparisonReportRecord]) -> None:
        self._write_collection(self.comparisons_path, [_model_dump(i) for i in items])

    def get_config(self) -> ConfigRecord:
        payload = self.store.read_json(self.config_path, {})
        if not payload:
            config = ConfigRecord(threshold=self.settings.app_compare_threshold)
            self.store.atomic_write_json(self.config_path, _model_dump(config))
            return config
        return _model_validate(ConfigRecord, payload)

    def _save_config(self, config: ConfigRecord) -> None:
        self.store.atomic_write_json(self.config_path, _model_dump(config))

    def reserve_commit_id(self) -> str:
        with self._lock:
            config = self.get_config()
            commit_id = format_id("c", config.next_commit_number)
            config.next_commit_number += 1
            self._save_config(config)
            return commit_id

    def reserve_report_id(self) -> str:
        with self._lock:
            config = self.get_config()
            report_id = format_id("r", config.next_report_number)
            config.next_report_number += 1
            self._save_config(config)
            return report_id

    def upsert_project(self, project_id: str, name: str | None = None) -> tuple[ProjectRecord, bool]:
        with self._lock:
            projects = self._load_projects()
            existing_index = next((idx for idx, p in enumerate(projects) if p.project_id == project_id), None)
            existing = projects[existing_index] if existing_index is not None else None
            if existing:
                if name and name != existing.name:
                    existing.name = name
                    existing.updated_at = utc_now_iso()
                    projects[existing_index] = existing
                    self._save_projects(projects)
                    self._sync_project(existing)
                return existing, False

            now = utc_now_iso()
            project = ProjectRecord(
                project_id=project_id,
                name=name or project_id,
                active_baseline_commit_id=None,
                created_at=now,
                updated_at=now,
            )
            projects.append(project)
            self._save_projects(projects)
            self._sync_project(project)
            return project, True

    def ensure_project(self, project_id: str, name: str | None = None) -> ProjectRecord:
        project, _ = self.upsert_project(project_id, name)
        return project

    def get_project(self, project_id: str) -> ProjectRecord:
        projects = self._load_projects()
        project = next((p for p in projects if p.project_id == project_id), None)
        if project is None:
            raise ApiError(
                ErrorCode.PROJECT_NOT_FOUND,
                f"Project '{project_id}' was not found.",
                status_code=404,
            )
        return project

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
        status: str,
        error: str | None,
    ) -> CommitRecord:
        with self._lock:
            commits = self._load_commits()
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
            commits.append(commit)
            self._save_commits(commits)
            self._sync_commit(commit)
            return commit

    def get_commit(self, commit_id: str, project_id: str | None = None) -> CommitRecord:
        commits = self._load_commits()
        commit = next((c for c in commits if c.commit_id == commit_id), None)
        if commit is None:
            raise ApiError(
                ErrorCode.COMMIT_NOT_FOUND,
                f"Commit '{commit_id}' was not found.",
                status_code=404,
            )
        if project_id is not None and commit.project_id != project_id:
            raise ApiError(
                ErrorCode.COMMIT_NOT_FOUND,
                f"Commit '{commit_id}' was not found in project '{project_id}'.",
                status_code=404,
            )
        return commit

    def set_baseline(self, project_id: str, commit_id: str) -> ProjectRecord:
        with self._lock:
            projects = self._load_projects()
            project = next((p for p in projects if p.project_id == project_id), None)
            if project is None:
                raise ApiError(
                    ErrorCode.PROJECT_NOT_FOUND,
                    f"Project '{project_id}' was not found.",
                    status_code=404,
                )

            commit = self.get_commit(commit_id, project_id=project_id)
            if commit.status != "success":
                raise ApiError(
                    ErrorCode.COMMIT_NOT_FOUND,
                    f"Commit '{commit_id}' is not a successful generation.",
                    status_code=404,
                )

            now = utc_now_iso()
            project.active_baseline_commit_id = commit_id
            project.updated_at = now

            updated: list[ProjectRecord] = []
            for item in projects:
                if item.project_id == project.project_id:
                    updated.append(project)
                else:
                    updated.append(item)

            self._save_projects(updated)
            self._sync_project(project)
            return project

    def list_history(self, project_id: str, limit: int, cursor: str | None) -> tuple[list[CommitRecord], str | None]:
        self.get_project(project_id)
        commits = [c for c in self._load_commits() if c.project_id == project_id]

        commits.sort(key=lambda c: parse_id_number(c.commit_id, "c"), reverse=True)

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
            reports = self._load_comparisons()
            reports.append(report)
            self._save_comparisons(reports)
            self._sync_comparison_report(report)
            return report

    def upload_commit_image(self, *, commit_id: str, filename: str, payload: bytes) -> str | None:
        if self.supabase_mirror is None:
            return None
        try:
            return self.supabase_mirror.upload_commit_image(
                commit_id=commit_id,
                filename=filename,
                payload=payload,
            )
        except Exception as exc:
            logger.warning(
                "supabase_image_sync_failed",
                extra={"extra_fields": {"commit_id": commit_id, "error": str(exc)}},
            )
            return None

    def _sync_project(self, project: ProjectRecord) -> None:
        if self.supabase_mirror is None:
            return
        try:
            self.supabase_mirror.upsert_project(project)
        except Exception as exc:
            logger.warning(
                "supabase_project_sync_failed",
                extra={"extra_fields": {"project_id": project.project_id, "error": str(exc)}},
            )

    def _sync_commit(self, commit: CommitRecord) -> None:
        if self.supabase_mirror is None:
            return
        try:
            self.supabase_mirror.upsert_commit(commit)
        except Exception as exc:
            logger.warning(
                "supabase_commit_sync_failed",
                extra={"extra_fields": {"commit_id": commit.commit_id, "error": str(exc)}},
            )

    def _sync_comparison_report(self, report: ComparisonReportRecord) -> None:
        if self.supabase_mirror is None:
            return
        try:
            self.supabase_mirror.upsert_comparison(report)
        except Exception as exc:
            logger.warning(
                "supabase_comparison_sync_failed",
                extra={"extra_fields": {"report_id": report.report_id, "error": str(exc)}},
            )
