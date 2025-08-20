from __future__ import annotations
from typing import List
from io import BytesIO
from tempfile import NamedTemporaryFile
from PIL import Image
import numpy as np
from moviepy import ImageClip, CompositeVideoClip, concatenate_videoclips

FPS = 40
BITRATE = "6000k"
DURATION_PER_IMAGE = 1.2
TRANSITION_DURATION = 0.5


def _slide_transition(clip1: ImageClip, clip2: ImageClip, duration: float = TRANSITION_DURATION, direction: str = "left"):
    w, h = clip1.size
    frame1 = clip1.get_frame(max(0, clip1.duration - 1e-6))
    frame2 = clip2.get_frame(1e-6)

    still1 = ImageClip(frame1).with_duration(duration)
    still2 = ImageClip(frame2).with_duration(duration)

    if direction == "left":
        still1 = still1.with_position(lambda t: (-w * (t / duration), 0))
        still2 = still2.with_position(lambda t: (w * (1 - t / duration), 0))
    else:
        still1 = still1.with_position(lambda t: (w * (t / duration), 0))
        still2 = still2.with_position(lambda t: (-w * (1 - t / duration), 0))

    return CompositeVideoClip([still1, still2], size=(w, h)).with_duration(duration)


def build_preview_video(frames_bytes: List[bytes]) -> bytes:
    """Build an MP4 preview from a list of image bytes. Uses temp file, returns bytes."""
    if not frames_bytes:
        raise ValueError("frames_bytes cannot be empty")

    base_clips = []
    for b in frames_bytes:
        im = Image.open(BytesIO(b))
        arr = np.array(im)
        base_clips.append(ImageClip(arr).with_duration(DURATION_PER_IMAGE))

    seq = []
    for i, clip in enumerate(base_clips):
        seq.append(clip)
        if i < len(base_clips) - 1:
            nxt = base_clips[i + 1]
            seq.append(_slide_transition(clip, nxt))

    final = concatenate_videoclips(seq, method="compose")

    tmp = NamedTemporaryFile(delete=False, suffix=".mp4")
    tmp.close()
    try:
        final.write_videofile(
            tmp.name,
            fps=FPS,
            codec="libx264",
            audio=False,
            preset="medium",
            threads=4,
            bitrate=BITRATE,
            logger=None,
        )
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        import os
        try:
            os.unlink(tmp.name)
        except Exception:
            pass
