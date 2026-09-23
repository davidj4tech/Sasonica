#!/usr/bin/env python3
"""Regenerate every derived icon from the SVG masters. Nothing here is hand-edited.

  python3 brand/regen.py

Masters: sasonica-mark.svg (the mark on its tile), android/ic_launcher_foreground.svg
(adaptive foreground, mark inside the 66 dp safe zone), android/ic_notification.svg
(one colour, alpha only).
"""
import pathlib, shutil
import cairosvg
from PIL import Image

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
MARK = HERE / "sasonica-mark.svg"
FOREGROUND = HERE / "android/ic_launcher_foreground.svg"
NOTIFICATION = HERE / "android/ic_notification.svg"

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def png(master, out, px, background=None):
    out.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(url=str(master), write_to=str(out),
                     output_width=px, output_height=px,
                     background_color=background)
    print(f"{out.relative_to(ROOT)}  {px}x{px}")


# --- the Android app's own resource tree -------------------------------------
# The launcher icon the app ships. Derived from the same masters, so brand/ and
# the app never drift. The debug variant keeps its own icons on purpose: they
# are how you tell a debug install from the release one side by side.
# Two apps ship the mark: Sasonica (android/, com.sasonica.app) and Sasonica
# Next (chat/android/, com.sasonica.next). Both are written from these masters
# so brand/ and the apps cannot drift. Sasonica's debug variant keeps its own
# icons on purpose: they are how you tell a debug install from the release one.
APP_RES = ROOT / "android/app/src/main/res"
NEXT_RES = ROOT / "chat/android/app/src/main/res"
TILE = "#15201c"

# The round legacy icon is the mark on a circle instead of the rounded tile.
ROUND_MARK = HERE / ".round-mark.svg"


def build_round_mark():
    s = MARK.read_text()
    tile = '<rect width="120" height="120" rx="28" fill="#15201c"/>'
    assert tile in s, "the master's tile changed shape — update build_round_mark()"
    ROUND_MARK.write_text(s.replace(tile, '<circle cx="60" cy="60" r="60" fill="#15201c"/>'))


def solid(out, px):
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (px, px), TILE).save(out)
    print(f"{out.relative_to(ROOT)}  {px}x{px}  solid {TILE}")


def app_icons(res, background_png):
    """background_png: Sasonica's adaptive XML points at @mipmap/ic_launcher_background,
    so it needs the colour as a bitmap; Next's points at @color and does not."""
    for density, scale in DENSITIES.items():
        d = res / f"mipmap-{density}"
        png(MARK, d / "ic_launcher.png", int(48 * scale))
        png(ROUND_MARK, d / "ic_launcher_round.png", int(48 * scale))
        png(FOREGROUND, d / "ic_launcher_foreground.png", int(108 * scale))
        if background_png:
            solid(d / "ic_launcher_background.png", int(108 * scale))
        png(NOTIFICATION, res / f"drawable-{density}/ic_notification.png", int(24 * scale))

for density, scale in DENSITIES.items():
    png(MARK, HERE / f"android/mipmap-{density}/ic_launcher.png", int(48 * scale))
    png(FOREGROUND, HERE / f"android/mipmap-{density}/ic_launcher_foreground.png", int(108 * scale))
    png(NOTIFICATION, HERE / f"android/drawable-{density}/ic_notification.png", int(24 * scale))

# The Play Store tile must be opaque — no alpha channel allowed.
png(MARK, HERE / "android/playstore-512.png", 512, background="#15201c")

shutil.copyfile(MARK, HERE / "web/favicon.svg")
print("web/favicon.svg  <- master")
for name, px in [("favicon-32.png", 32), ("apple-touch-icon.png", 180),
                 ("icon-192.png", 192), ("icon-512.png", 512)]:
    png(MARK, HERE / "web" / name, px)

build_round_mark()
app_icons(APP_RES, background_png=True)
app_icons(NEXT_RES, background_png=False)
ROUND_MARK.unlink()
