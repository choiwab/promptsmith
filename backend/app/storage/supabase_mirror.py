from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from backend.app.core.config import Settings
from backend.app.storage.schemas import CommitRecord, ComparisonReportRecord, ProjectRecord


@dataclass(frozen=True)
class SupabaseMirrorConfig:
    url: str
    service_role_key: str
    bucket: str
    table_prefix: str
    schema: str
    timeout_seconds: float


class SupabaseMirror:
    def __init__(self, settings: Settings):
        if not settings.supabase_enabled:
            raise ValueError("SupabaseMirror requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")

        assert settings.supabase_url is not None
        assert settings.supabase_service_role_key is not None

        self.config = SupabaseMirrorConfig(
            url=settings.supabase_url.rstrip("/"),
            service_role_key=settings.supabase_service_role_key,
            bucket=settings.supabase_storage_bucket,
            table_prefix=settings.supabase_table_prefix,
            schema=settings.supabase_schema,
            timeout_seconds=settings.openai_timeout_seconds,
        )
        self._client = httpx.Client(timeout=self.config.timeout_seconds)

    def table_name(self, base_name: str) -> str:
        return f"{self.config.table_prefix}{base_name}"

    def upload_commit_image(self, *, commit_id: str, filename: str, payload: bytes, content_type: str = "image/png") -> str:
        object_path = f"commits/{commit_id}/{filename}"
        url = f"{self.config.url}/storage/v1/object/{self.config.bucket}/{object_path}"

        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
            "x-upsert": "true",
            "Content-Type": content_type,
        }

        response = self._client.post(url, headers=headers, content=payload)
        if response.status_code >= 400:
            raise RuntimeError(self._format_error("storage upload", response))

        return f"{self.config.url}/storage/v1/object/public/{self.config.bucket}/{object_path}"

    def upsert_project(self, project: ProjectRecord) -> None:
        self._upsert("projects", project.project_id, _model_dump(project), "project_id")

    def upsert_commit(self, commit: CommitRecord) -> None:
        self._upsert("commits", commit.commit_id, _model_dump(commit), "commit_id")

    def upsert_comparison(self, report: ComparisonReportRecord) -> None:
        self._upsert("comparisons", report.report_id, _model_dump(report), "report_id")

    def _upsert(self, base_table: str, entity_id: str, payload: dict[str, Any], conflict_column: str) -> None:
        table = self.table_name(base_table)
        url = f"{self.config.url}/rest/v1/{table}"

        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Profile": self.config.schema,
            "Content-Profile": self.config.schema,
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }
        params = {"on_conflict": conflict_column}

        response = self._client.post(url, headers=headers, params=params, json=[payload])
        if response.status_code >= 400:
            raise RuntimeError(self._format_error(f"upsert {base_table} ({entity_id})", response))

    def _format_error(self, operation: str, response: httpx.Response) -> str:
        details = ""
        try:
            payload = response.json()
            if isinstance(payload, dict):
                message = payload.get("message")
                if isinstance(message, str):
                    details = message
                elif "error" in payload:
                    details = str(payload["error"])
        except Exception:
            details = ""

        if details:
            return f"Supabase {operation} failed ({response.status_code}): {details}"
        return f"Supabase {operation} failed ({response.status_code})."


def _model_dump(instance: Any) -> dict[str, Any]:
    if hasattr(instance, "model_dump"):
        return instance.model_dump()
    return instance.dict()
