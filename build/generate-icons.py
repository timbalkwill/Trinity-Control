#!/usr/bin/env python3
"""Generate Trinity Control application icons from the approved square artwork."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "build" / "icons"
CANONICAL = ICON_DIR / "trinity-control.png"
SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)


def remove_connected_white_corners(image: Image.Image) -> Image.Image:
    """Make only the source's border-connected near-white canvas transparent."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    pending = [(x, 0) for x in range(width)] + [(x, height - 1) for x in range(width)]
    pending += [(0, y) for y in range(1, height - 1)] + [(width - 1, y) for y in range(1, height - 1)]
    visited: set[tuple[int, int]] = set()

    while pending:
        x, y = pending.pop()
        if (x, y) in visited:
            continue
        visited.add((x, y))
        red, green, blue, _ = pixels[x, y]
        if min(red, green, blue) < 60:
            continue
        pixels[x, y] = (red, green, blue, 0)
        if x:
            pending.append((x - 1, y))
        if x + 1 < width:
            pending.append((x + 1, y))
        if y:
            pending.append((x, y - 1))
        if y + 1 < height:
            pending.append((x, y + 1))
    return rgba


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", nargs="?", help="Approved square source; omit to rebuild from the canonical PNG")
    args = parser.parse_args()

    ICON_DIR.mkdir(parents=True, exist_ok=True)
    if args.source:
        source = Path(args.source).expanduser().resolve()
        image = Image.open(source)
        if image.width != image.height or image.width < 1024:
            raise SystemExit("Approved icon source must be square and at least 1024x1024")
        image = remove_connected_white_corners(image)
        image.save(CANONICAL, optimize=True)
    else:
        image = Image.open(CANONICAL).convert("RGBA")

    png_dir = ICON_DIR / "png"
    png_dir.mkdir(exist_ok=True)
    rendered: dict[int, Image.Image] = {}
    for size in SIZES:
        rendered[size] = image.resize((size, size), Image.Resampling.LANCZOS)
        rendered[size].save(png_dir / f"{size}.png", optimize=True)

    rendered[256].save(
        ICON_DIR / "trinity-control.ico",
        format="ICO",
        sizes=[(size, size) for size in SIZES if size <= 256],
    )

    image.save(ICON_DIR / "trinity-control.icns", format="ICNS")


if __name__ == "__main__":
    main()
