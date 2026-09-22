# Sasonica brand assets

The mark (chosen 2026-09-22): a listener in profile wearing a headset, two
rings of voice spreading from the mic, and a forward arrow: a spoken
conversation with an agent that gets things done. Tagline: "Talk to your
agents." Design history: https://claude.ai/artifact/Hb3LsHqjB7cEK1dvwPpCRm

| Token | Hex | Use |
| --- | --- | --- |
| Ground | `#0D1412` | app background |
| Tile | `#15201C` | icon tile, cards, adaptive icon background |
| Signal | `#7FD1AE` | head, mic, first ring, arrow, accent |
| Signal 62% | `#578E77` | ear cup, boom, second ring (the accent over the tile) |
| Text | `#E7EFE9` | text on dark |

Type: Fraunces (wordmark, display) + IBM Plex Sans (body).

Files:
- `sasonica-mark.svg` — the master: the mark on its rounded tile.
- `android/` — `mipmap-*/ic_launcher.png` (legacy), `mipmap-*/ic_launcher_foreground.png` +
  `ic_launcher_foreground.svg` + `ic_launcher_background.xml` (adaptive icon, mark inside the
  66 dp safe zone), `drawable-*/ic_notification.png` + `.svg` (one colour, alpha only: head,
  rings, arrow — the cup and boom are too fine at 24 dp), `playstore-512.png`.
- `web/` — `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`.

Regenerate from the master with cairosvg (see the session notes); every size is derived, never hand-edited.
