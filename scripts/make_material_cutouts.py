"""Remove studio white backgrounds from raw material photos → transparent PNGs."""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ASSETS = Path(
    r"C:\Users\19076\.cursor\projects\c-Users-19076-Desktop-cursor-AuroraAI2607\assets"
)
OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "materials"

MAPPING = {
    "tree-broadleaf-raw.png": "tree-broadleaf.png",
    "tree-pine-raw.png": "tree-pine.png",
    "palm-raw.png": "palm.png",
    "bush-raw.png": "bush.png",
    "shrub-flower-raw.png": "shrub-flower.png",
    "person-stand-raw.png": "person-stand.png",
    "person-walk-raw.png": "person-walk.png",
    "people-pair-raw.png": "people-pair.png",
}


def is_bg(r: int, g: int, b: int, thresh: int = 238) -> bool:
    return (
        r >= thresh
        and g >= thresh
        and b >= thresh
        and abs(int(r) - int(g)) < 18
        and abs(int(g) - int(b)) < 18
    )


def remove_bg_flood(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]
    alpha = arr[:, :, 3].copy()
    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            r, g, b, _a = arr[y, x]
            if is_bg(r, g, b):
                q.append((x, y))
                visited[y, x] = True
    for y in range(h):
        for x in (0, w - 1):
            if visited[y, x]:
                continue
            r, g, b, _a = arr[y, x]
            if is_bg(r, g, b):
                q.append((x, y))
                visited[y, x] = True

    while q:
        x, y = q.popleft()
        alpha[y, x] = 0
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h or visited[ny, nx]:
                continue
            r, g, b, _a = arr[ny, nx]
            if is_bg(r, g, b, thresh=232):
                visited[ny, nx] = True
                q.append((nx, ny))

    for y in range(h):
        for x in range(w):
            if alpha[y, x] == 0:
                continue
            r, g, b = arr[y, x, :3]
            if not is_bg(r, g, b, thresh=245):
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h and alpha[ny, nx] == 0:
                    alpha[y, x] = 0
                    break

    arr[:, :, 3] = alpha
    out = Image.fromarray(arr, "RGBA")
    bbox = out.getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        pad = 4
        out = out.crop(
            (
                max(0, x0 - pad),
                max(0, y0 - pad),
                min(w, x1 + pad),
                min(h, y1 + pad),
            )
        )
    mw, mh = out.size
    max_side = 900
    scale = min(1.0, max_side / max(mw, mh))
    if scale < 1:
        out = out.resize(
            (max(1, int(mw * scale)), max(1, int(mh * scale))),
            Image.Resampling.LANCZOS,
        )
    return out


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for src_name, dst_name in MAPPING.items():
        src = ASSETS / src_name
        if not src.exists():
            print("MISSING", src)
            continue
        result = remove_bg_flood(Image.open(src))
        dst = OUT_DIR / dst_name
        result.save(dst, "PNG", optimize=True)
        print(f"OK {dst_name} {result.size} {dst.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
