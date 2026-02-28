from __future__ import annotations


ID_WIDTH = 4


def format_id(prefix: str, number: int) -> str:
    return f"{prefix}{number:0{ID_WIDTH}d}"


def parse_id_number(identifier: str, prefix: str) -> int:
    if not identifier.startswith(prefix):
        return -1
    suffix = identifier[len(prefix) :]
    if not suffix.isdigit():
        return -1
    return int(suffix)
