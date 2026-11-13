"""Cuts the crew out of the restaurant art, so only their own pixels move on the board.

scripts/art/restaurant.webp is the developer's picture. This writes, next to the board page:
  room.webp  the picture with the crew painted over by the room around them; it stays still.
  crew.webp  the crew alone on a transparent picture of the same size, laid over the room.
Each crew member is a few blocks in picture pixels; they must stay inside the boxes in
src/cli/board-kitchen.ts. Run again after changing the art or a block:
  python3 -I scripts/kitchen-art.py   (needs Pillow with WebP, and NumPy)
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "scripts" / "art" / "restaurant.webp"
OUT = ROOT / "src" / "cli" / "board-ui"

# x1, y1, x2, y2 in picture pixels: hat, head, chin, body, arms, what they hold, legs.
CREW = {
    "head_chef": [
        (40, 240, 77, 251), (30, 250, 88, 310), (40, 310, 78, 319), (30, 319, 88, 357),
        (20, 328, 40, 353), (88, 328, 97, 337), (42, 332, 90, 354),
        (30, 357, 50, 381), (60, 357, 80, 381),
    ],
    "cook": [
        (163, 274, 200, 283), (152, 283, 210, 322), (162, 322, 201, 331), (152, 330, 210, 370),
        (145, 341, 153, 360), (210, 339, 232, 348),
        (152, 370, 172, 386), (190, 370, 210, 386),
    ],
    "sous_chef": [
        (275, 274, 333, 322), (285, 322, 323, 330), (275, 330, 333, 370), (267, 341, 342, 359),
    ],
    "taster": [
        (398, 280, 457, 323), (408, 322, 446, 331), (398, 331, 457, 370), (392, 341, 398, 351),
        (398, 370, 417, 386), (437, 370, 457, 386),
    ],
    "inspector": [
        (532, 263, 570, 284), (512, 283, 589, 294), (521, 293, 580, 322), (531, 322, 570, 331),
        (521, 331, 580, 370), (511, 340, 521, 360), (580, 350, 589, 360), (577, 318, 598, 345),
        (521, 370, 540, 386), (560, 370, 580, 386),
    ],
    "waiter": [
        (460, 480, 518, 491), (459, 490, 518, 519), (469, 519, 508, 529), (460, 529, 517, 578),
        (504, 526, 540, 542), (450, 547, 460, 559), (517, 547, 528, 559),
        (460, 578, 480, 588), (498, 578, 517, 588),
    ],
    "customer": [
        (889, 458, 927, 468), (879, 468, 937, 512), (889, 511, 927, 517), (879, 516, 937, 556),
        (870, 535, 880, 546), (937, 535, 947, 546), (910, 528, 947, 568),
        (879, 556, 897, 570), (917, 556, 937, 570),
    ],
}


def grow(mask: np.ndarray, by: int) -> np.ndarray:
    """The mask and every pixel within `by` of it: the art's blocks have soft edges."""
    out = mask.copy()
    for dy in range(-by, by + 1):
        for dx in range(-by, by + 1):
            out |= np.roll(np.roll(mask, dy, 0), dx, 1)
    return out


def fill(rgb: np.ndarray, hole: np.ndarray) -> np.ndarray:
    """Paints the hole from its edge inwards, each pixel the mean of its painted neighbours."""
    rgb = rgb.astype(np.float64)
    known = ~hole
    steps = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]
    while not known.all():
        total = np.zeros_like(rgb)
        count = np.zeros(known.shape)
        for dy, dx in steps:
            k = np.roll(np.roll(known, dy, 0), dx, 1)
            total += np.roll(np.roll(rgb, dy, 0), dx, 1) * k[..., None]
            count += k
        edge = ~known & (count > 0)
        rgb[edge] = total[edge] / count[edge][:, None]
        known |= edge
    return rgb.round().astype(np.uint8)


def main() -> None:
    art = np.asarray(Image.open(SOURCE).convert("RGB"))
    crew = np.zeros(art.shape[:2], bool)
    for blocks in CREW.values():
        for x1, y1, x2, y2 in blocks:
            crew[y1:y2, x1:x2] = True
    crew = grow(crew, 1)
    room = fill(art, grow(crew, 1))
    Image.fromarray(room).save(OUT / "room.webp", quality=90, method=6)
    sprites = np.dstack([art, np.where(crew, 255, 0).astype(np.uint8)])
    Image.fromarray(sprites, "RGBA").save(OUT / "crew.webp", quality=90, alpha_quality=100, method=6)


if __name__ == "__main__":
    main()
