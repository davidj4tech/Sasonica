#!/usr/bin/env python3
"""Regenerate every derived icon from the SVG masters. Nothing here is hand-edited.

  python3 brand/regen.py

Masters: sasonica-mark.svg (the mark on its tile), android/ic_launcher_foreground.svg
(adaptive foreground, mark inside the 66 dp safe zone), android/ic_notification.svg
(one colour, alpha only).
"""
import pathlib, shutil
import math

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
# --- the ABS variant ---------------------------------------------------------
# Sasonica (com.sasonica.app) is the Audiobookshelf fork; Sasonica Next
# (com.sasonica.next) is the chat app. They sit side by side on the home
# screen, so the old one carries an ABS wordmark under the mark. The letters
# are drawn from the mark's own vocabulary — monoline, round caps — rather than
# set in a typeface, so regenerating needs no font installed.
SIGNAL = "#7fd1ae"


def abs_wordmark(centre_x, baseline, cap, weight):
    """A B S as three monoline strokes, centred on centre_x."""
    top, bot = baseline - cap, baseline
    mid = (top + bot) / 2
    r = cap / 4
    advance = cap * 0.62 + weight * 1.5
    a_w, b_w = cap * 0.58, cap * 0.30
    width = advance * 2 + 2 * r
    x = centre_x - width / 2
    out = []

    def stroke(d):
        out.append(f'<path d="{d}" fill="none" stroke="{SIGNAL}" stroke-width="{weight}" '
                   f'stroke-linecap="round" stroke-linejoin="round"/>')

    stroke(f"M{x:.2f} {bot:.2f} L{x + a_w / 2:.2f} {top:.2f} L{x + a_w:.2f} {bot:.2f}")
    stroke(f"M{x + a_w * 0.21:.2f} {top + cap * 0.62:.2f} L{x + a_w * 0.79:.2f} {top + cap * 0.62:.2f}")
    x += advance
    stroke(f"M{x:.2f} {top:.2f} L{x:.2f} {bot:.2f}")
    stroke(f"M{x:.2f} {top:.2f} L{x + b_w:.2f} {top:.2f} A {r:.2f} {r:.2f} 0 0 1 {x + b_w:.2f} {mid:.2f} L{x:.2f} {mid:.2f}")
    stroke(f"M{x:.2f} {mid:.2f} L{x + b_w:.2f} {mid:.2f} A {r:.2f} {r:.2f} 0 0 1 {x + b_w:.2f} {bot:.2f} L{x:.2f} {bot:.2f}")
    x += advance
    cx = x + r
    a1, a3 = math.radians(-40), math.radians(140)
    stroke(f"M{cx + r * math.cos(a1):.2f} {top + r + r * math.sin(a1):.2f} "
           f"A {r:.2f} {r:.2f} 0 1 0 {cx:.2f} {mid:.2f} "
           f"A {r:.2f} {r:.2f} 0 1 1 {cx + r * math.cos(a3):.2f} {bot - r + r * math.sin(a3):.2f}")
    return "".join(out)


def build_abs(source, out, centre, lift, scale, baseline, cap, weight):
    """Shrink and raise the lockup in `source`, then set ABS under it."""
    text = source.read_text()
    head = text[:text.index("<g transform")]
    body = text[text.index("<g transform"):text.rindex("</svg>")]
    inner = f'<g transform="translate({centre} {centre - lift}) scale({scale}) translate({-centre} {-centre})">{body}</g>'
    out.write_text(head + inner + abs_wordmark(centre, baseline, cap, weight) + "</svg>")


ABS_MARK = HERE / ".abs-mark.svg"
ABS_FOREGROUND = HERE / ".abs-foreground.svg"

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


def app_icons(res, background_png, mark, foreground):
    """background_png: Sasonica's adaptive XML points at @mipmap/ic_launcher_background,
    so it needs the colour as a bitmap; Next's points at @color and does not."""
    for density, scale in DENSITIES.items():
        d = res / f"mipmap-{density}"
        png(mark, d / "ic_launcher.png", int(48 * scale))
        png(ROUND_MARK, d / "ic_launcher_round.png", int(48 * scale))
        png(foreground, d / "ic_launcher_foreground.png", int(108 * scale))
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
# Sasonica carries the ABS wordmark; Next carries the mark alone.
build_abs(MARK, ABS_MARK, centre=60, lift=11, scale=0.80, baseline=105, cap=15, weight=4.2)
# The adaptive foreground has to clear Android's 66 dp safe circle with the
# wordmark inside it too. These numbers put the furthest ink at 31.96 dp
# against the 33.0 radius; anything larger spills (0.86/13 measures 33.27).
build_abs(FOREGROUND, ABS_FOREGROUND, centre=54, lift=9.85, scale=0.82,
          baseline=78.05, cap=12.5, weight=3.5)
app_icons(APP_RES, background_png=True, mark=ABS_MARK, foreground=ABS_FOREGROUND)
app_icons(NEXT_RES, background_png=False, mark=MARK, foreground=FOREGROUND)
for tmp in (ROUND_MARK, ABS_MARK, ABS_FOREGROUND):
    tmp.unlink()
