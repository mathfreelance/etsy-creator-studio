from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class ProcessManifest(BaseModel):
    dpi: int
    enhance: bool
    upscale: int
    mockups: bool
    video: bool
    texts: bool
    generated: List[Dict[str, Any]] = Field(default_factory=list)

class TextOptions(BaseModel):
    title: bool = True
    alt_seo: bool = True
    description: bool = True
    tags: bool = True
