from pathlib import Path
from moviepy import ImageClip, CompositeVideoClip, concatenate_videoclips

# --- Config ---
IMAGE_FILES = [
    "mockups/output/mockup_1.jpg",
    "mockups/output/mockup_2.jpg",
    "mockups/output/mockup_3.jpg",
    "mockups/output/mockup_4.jpg",
    "mockups/output/mockup_5.jpg",
    "mockups/output/mockup_6.jpg",
]

OUTPUT_MP4 = "mockups/output/preview.mp4"
DURATION_PER_IMAGE = 1.2   # durée d'affichage de chaque image (en secondes)
TRANSITION_DURATION = 0.5  # durée du slide (en secondes)
FPS = 40
BITRATE = "6000k"          # ajuste si besoin

def slide_transition(clip1: ImageClip, clip2: ImageClip, duration: float = 0.6, direction: str = "left"):
    """
    Crée une transition 'slide' entre clip1 et clip2 en MoviePy 2.x.
    On prend le DERNIER frame de clip1 et le PREMIER frame de clip2 (images fixes),
    puis on les fait glisser l'une sur l'autre pendant 'duration'.
    direction:
      - 'left'  : clip1 -> sort vers la gauche ; clip2 -> entre depuis la droite
      - 'right' : clip1 -> sort vers la droite ; clip2 -> entre depuis la gauche
    """
    w, h = clip1.size

    # Récupère deux ImageClip fixes (dernier frame de clip1, premier frame de clip2)
    # (Un "freeze" sur la fin/début suffit pour une transition propre)
    frame1 = clip1.get_frame(max(0, clip1.duration - 1e-6))
    frame2 = clip2.get_frame(1e-6)  # ~ tout début

    still1 = ImageClip(frame1).with_duration(duration)
    still2 = ImageClip(frame2).with_duration(duration)

    if direction == "left":
        # x1: 0 -> -w ; x2: +w -> 0
        still1 = still1.with_position(lambda t: (-w * (t / duration), 0))
        still2 = still2.with_position(lambda t: (w * (1 - t / duration), 0))
    else:  # "right"
        # x1: 0 -> +w ; x2: -w -> 0
        still1 = still1.with_position(lambda t: (w * (t / duration), 0))
        still2 = still2.with_position(lambda t: (-w * (1 - t / duration), 0))

    trans = CompositeVideoClip([still1, still2], size=(w, h)).with_duration(duration)
    return trans

def main():
    # Vérifie les fichiers
    for p in IMAGE_FILES:
        if not Path(p).exists():
            raise FileNotFoundError(f"Image introuvable: {p}")

    # Crée un ImageClip par image avec la bonne durée
    base_clips = [ImageClip(p).with_duration(DURATION_PER_IMAGE) for p in IMAGE_FILES]

    # Construit la séquence: image -> transition -> image -> transition ...
    seq = []
    for i, clip in enumerate(base_clips):
        seq.append(clip)
        if i < len(base_clips) - 1:
            nxt = base_clips[i + 1]
            seq.append(slide_transition(clip, nxt, TRANSITION_DURATION, direction="left"))

    final = concatenate_videoclips(seq, method="compose")

    Path(OUTPUT_MP4).parent.mkdir(parents=True, exist_ok=True)
    final.write_videofile(
        OUTPUT_MP4,
        fps=FPS,
        codec="libx264",
        audio=False,
        preset="medium",
        threads=4,
        bitrate=BITRATE,
    )
    print(f"✅ Vidéo créée: {OUTPUT_MP4}")

if __name__ == "__main__":
    main()
