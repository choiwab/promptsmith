from __future__ import annotations

import json
from pathlib import Path

from backend.app.main import app


def main() -> None:
    schema = app.openapi()
    output = Path("backend/openapi.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        json.dump(schema, handle, indent=2, ensure_ascii=True)
    print(f"Wrote OpenAPI schema to {output}")


if __name__ == "__main__":
    main()
