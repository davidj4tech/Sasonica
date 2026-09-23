#!/usr/bin/env python3
"""Regenerate every derived icon from the SVG masters. Nothing here is hand-edited.

  python3 brand/regen.py

Masters: sasonica-mark.svg (the mark on its tile), android/ic_launcher_foreground.svg
(adaptive foreground, mark inside the 66 dp safe zone), android/ic_notification.svg
(one colour, alpha only).
"""
import pathlib, shutil
import cairosvg

HERE = pathlib.Path(__file__).parent
MARK = HERE / "sasonica-mark.svg"
FOREGROUND = HERE / "android/ic_launcher_foreground.svg"
NOTIFICATION = HERE / "android/ic_notification.svg"

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def png(master, out, px, background=None):
    out.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(url=str(master), write_to=str(out),
                     output_width=px, output_height=px,
                     background_color=background)
    print(f"{out.relative_to(HERE)}  {px}x{px}")


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
