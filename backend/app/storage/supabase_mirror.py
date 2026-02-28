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

    def list_projects(self) -> list[dict[str, Any]]:
        return self._select(
            "projects",
            params={
                "select": "*",
                "order": "updated_at.desc",
            },
        )

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        rows = self._select(
            "projects",
            params={
                "select": "*",
                "project_id": f"eq.{project_id}",
                "limit": "1",
            },
        )
        return rows[0] if rows else None

    def insert_project(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._insert("projects", payload)

    def update_project(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        rows = self._update(
            "projects",
            filters={"project_id": f"eq.{project_id}"},
            payload=payload,
        )
        return rows[0] if rows else None

    def get_commit(self, commit_id: str) -> dict[str, Any] | None:
        rows = self._select(
            "commits",
            params={
                "select": "*",
                "commit_id": f"eq.{commit_id}",
                "limit": "1",
            },
        )
        return rows[0] if rows else None

    def list_commits(self, project_id: str) -> list[dict[str, Any]]:
        # Keep a high cap for demo workflows; API paging still applies upstream.
        return self._select(
            "commits",
            params={
                "select": "*",
                "project_id": f"eq.{project_id}",
                "limit": "10000",
            },
        )

    def insert_commit(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._insert("commits", payload)

    def insert_comparison(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._insert("comparisons", payload)

    def list_comparisons(self, project_id: str) -> list[dict[str, Any]]:
        return self._select(
            "comparisons",
            params={
                "select": "*",
                "project_id": f"eq.{project_id}",
                "limit": "10000",
            },
        )

    def delete_commits(self, commit_ids: list[str]) -> list[dict[str, Any]]:
        if not commit_ids:
            return []
        return self._delete_rows(
            "commits",
            filters={"commit_id": f"in.({','.join(commit_ids)})"},
        )

    def delete_comparisons(self, report_ids: list[str]) -> list[dict[str, Any]]:
        if not report_ids:
            return []
        return self._delete_rows(
            "comparisons",
            filters={"report_id": f"in.({','.join(report_ids)})"},
        )

    def delete_all_records(self, base_table: str, id_column: str) -> None:
        table = self.table_name(base_table)
        url = f"{self.config.url}/rest/v1/{table}"

        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Profile": self.config.schema,
            "Content-Profile": self.config.schema,
        }
        params = {id_column: "not.is.null"}

        response = self._client.delete(url, headers=headers, params=params)
        if response.status_code >= 400:
            raise RuntimeError(self._format_error(f"delete all rows from {base_table}", response))

    def delete_storage_object(self, object_path: str) -> bool:
        object_path = object_path.strip("/")
        if not object_path:
            return False

        url = f"{self.config.url}/storage/v1/object/{self.config.bucket}/{object_path}"
        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
        }
        response = self._client.delete(url, headers=headers)
        return response.status_code < 400

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

    def _select(self, base_table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        table = self.table_name(base_table)
        url = f"{self.config.url}/rest/v1/{table}"
        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
            "Accept": "application/json",
            "Accept-Profile": self.config.schema,
        }
        response = self._client.get(url, headers=headers, params=params)
        if response.status_code >= 400:
            raise RuntimeError(self._format_error(f"select from {base_table}", response))

        payload = response.json()
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        return []

    def _insert(self, base_table: str, payload: dict[str, Any]) -> dict[str, Any]:
        table = self.table_name(base_table)
        url = f"{self.config.url}/rest/v1/{table}"
        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Profile": self.config.schema,
            "Content-Profile": self.config.schema,
            "Prefer": "return=representation",
        }
        response = self._client.post(url, headers=headers, json=[payload])
        if response.status_code >= 400:
            raise RuntimeError(self._format_error(f"insert into {base_table}", response))
        data = response.json()
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return data[0]
        return payload

    def _update(self, base_table: str, *, filters: dict[str, str], payload: dict[str, Any]) -> list[dict[str, Any]]:
        table = self.table_name(base_table)
        url = f"{self.config.url}/rest/v1/{table}"
        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Profile": self.config.schema,
            "Content-Profile": self.config.schema,
            "Prefer": "return=representation",
        }
        response = self._client.patch(url, headers=headers, params=filters, json=payload)
        if response.status_code >= 400:
            raise RuntimeError(self._format_error(f"update {base_table}", response))

        data = response.json()
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

    def _delete_rows(self, base_table: str, *, filters: dict[str, str]) -> list[dict[str, Any]]:
        table = self.table_name(base_table)
        url = f"{self.config.url}/rest/v1/{table}"
        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
            "Accept": "application/json",
            "Accept-Profile": self.config.schema,
            "Content-Profile": self.config.schema,
            "Prefer": "return=representation",
        }
        response = self._client.delete(url, headers=headers, params=filters)
        if response.status_code >= 400:
            raise RuntimeError(self._format_error(f"delete from {base_table}", response))

        data = response.json()
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

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
