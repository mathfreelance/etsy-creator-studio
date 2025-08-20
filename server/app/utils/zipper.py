from __future__ import annotations
from typing import List, Tuple
from io import BytesIO
import zipfile


def build_zip_bytes(files: List[Tuple[str, bytes]]) -> bytes:
    """Build an in-memory ZIP from [(path, bytes)]."""
    mem = BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, data in files:
            zf.writestr(path, data)
    return mem.getvalue()
