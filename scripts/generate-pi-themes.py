#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""Generate pi themes from iTerm2 .itermcolors files.

Mapping derived from reverse-engineering all 10 official pi-themes
(gruvbox-dark, catppuccin-mocha, dracula, nord, one-dark, solarized-*,
tokyo-night, gruvbox-light, catppuccin-latte) against their upstream
Ghostty/iTerm2 terminal palette sources.

Primary usage:
    mise run themes:generate
    mise run themes:generate --name "Gruvbox Dark"
    mise run themes:validate
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import plistlib
import re
import sys
import tomllib

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
CURATED_PATH = REPO_ROOT / "curated.toml"
SCHEMES_DIR = REPO_ROOT / ".upstream" / "iTerm2-Color-Schemes" / "schemes"
OUTPUT_DIR = REPO_ROOT / "themes"
SCHEMA_URL = "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json"


# ---------------------------------------------------------------------------
# Color math
# ---------------------------------------------------------------------------

def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgb_to_hex(r: float, g: float, b: float) -> str:
    return "#{:02x}{:02x}{:02x}".format(
        max(0, min(255, int(r))),
        max(0, min(255, int(g))),
        max(0, min(255, int(b))),
    )


def lighten(c: str, amt: int) -> str:
    r, g, b = hex_to_rgb(c)
    return rgb_to_hex(r + amt, g + amt, b + amt)


def darken(c: str, amt: int) -> str:
    return lighten(c, -amt)


def mix(c1: str, c2: str, ratio: float = 0.5) -> str:
    r1, g1, b1 = hex_to_rgb(c1)
    r2, g2, b2 = hex_to_rgb(c2)
    return rgb_to_hex(
        r1 * ratio + r2 * (1 - ratio),
        g1 * ratio + g2 * (1 - ratio),
        b1 * ratio + b2 * (1 - ratio),
    )


def luminance(c: str) -> float:
    r, g, b = hex_to_rgb(c)
    return 0.299 * r + 0.587 * g + 0.114 * b


def saturation(c: str) -> float:
    r, g, b = hex_to_rgb(c)
    mx, mn = max(r, g, b), min(r, g, b)
    return (mx - mn) / mx if mx > 0 else 0.0


def hue_angle(c: str) -> float:
    r, g, b = (x / 255.0 for x in hex_to_rgb(c))
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0:
        return 0.0
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return (h * 60 + 360) % 360


def color_dist(a: str, b: str) -> float:
    ra, ga, ba = hex_to_rgb(a)
    rb, gb, bb = hex_to_rgb(b)
    return ((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2) ** 0.5


def hue_distance(c1: str, c2: str) -> float:
    h1, h2 = hue_angle(c1), hue_angle(c2)
    d = abs(h1 - h2)
    return min(d, 360 - d)


def ensure_contrast(fg: str, bg: str, min_diff: int = 45) -> str:
    fl, bl = luminance(fg), luminance(bg)
    if abs(fl - bl) >= min_diff:
        return fg
    needed = int(min_diff - abs(fl - bl))
    return lighten(fg, needed) if bl < 128 else darken(fg, needed)


# ---------------------------------------------------------------------------
# P3 -> sRGB
# ---------------------------------------------------------------------------

def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c < 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c: float) -> float:
    return 12.92 * c if c < 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def p3_to_srgb(r: float, g: float, b: float) -> tuple[float, float, float]:
    rl, gl, bl = _srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b)
    x = 0.4865709486 * rl + 0.2656676932 * gl + 0.1982172852 * bl
    y = 0.2289745641 * rl + 0.6917385218 * gl + 0.0792869141 * bl
    z = 0.0000000000 * rl + 0.0451133819 * gl + 1.0439443689 * bl
    sr = 3.2404541621 * x - 1.5371385940 * y - 0.4985314096 * z
    sg = -0.9692660305 * x + 1.8760108454 * y + 0.0415560175 * z
    sb = 0.0556434309 * x - 0.2040259135 * y + 1.0572251882 * z
    return (
        max(0.0, min(1.0, _linear_to_srgb(sr))),
        max(0.0, min(1.0, _linear_to_srgb(sg))),
        max(0.0, min(1.0, _linear_to_srgb(sb))),
    )


# ---------------------------------------------------------------------------
# .itermcolors parser
# ---------------------------------------------------------------------------

ITERM_KEY_MAP = {
    "Ansi 0 Color": 0, "Ansi 1 Color": 1, "Ansi 2 Color": 2, "Ansi 3 Color": 3,
    "Ansi 4 Color": 4, "Ansi 5 Color": 5, "Ansi 6 Color": 6, "Ansi 7 Color": 7,
    "Ansi 8 Color": 8, "Ansi 9 Color": 9, "Ansi 10 Color": 10, "Ansi 11 Color": 11,
    "Ansi 12 Color": 12, "Ansi 13 Color": 13, "Ansi 14 Color": 14, "Ansi 15 Color": 15,
}

ITERM_SPECIAL_KEYS = {
    "Background Color": "background",
    "Foreground Color": "foreground",
    "Cursor Color": "cursor-color",
    "Cursor Text Color": "cursor-text",
    "Selection Color": "selection-background",
    "Selected Text Color": "selection-foreground",
}


def _color_dict_to_hex(d: dict) -> str:
    r = float(d.get("Red Component", 0))
    g = float(d.get("Green Component", 0))
    b = float(d.get("Blue Component", 0))
    cs = str(d.get("Color Space", "sRGB")).strip()
    if cs == "P3":
        r, g, b = p3_to_srgb(r, g, b)
    return rgb_to_hex(r * 255, g * 255, b * 255)


def parse_itermcolors(path: pathlib.Path) -> dict:
    with open(path, "rb") as f:
        plist = plistlib.load(f)
    result: dict = {"palette": {}}
    for key, data in plist.items():
        if not isinstance(data, dict):
            continue
        hex_color = _color_dict_to_hex(data)
        if key in ITERM_KEY_MAP:
            result["palette"][ITERM_KEY_MAP[key]] = hex_color
        elif key in ITERM_SPECIAL_KEYS:
            result[ITERM_SPECIAL_KEYS[key]] = hex_color
    return result


# ---------------------------------------------------------------------------
# Curated list
# ---------------------------------------------------------------------------

def load_curated() -> list[str]:
    with open(CURATED_PATH, "rb") as f:
        data = tomllib.load(f)
    return data.get("themes", [])


def slugify(name: str) -> str:
    s = name.lower()
    s = s.replace("+", "-plus")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


# ---------------------------------------------------------------------------
# Theme generation
#
# Mapping derived from comparing all 10 official pi-themes against their
# upstream iTerm2/Ghostty terminal palette sources.
#
# VARS: direct palette lookups + minimal derivations
# COLORS: consistent wiring patterns observed across all official themes
# ---------------------------------------------------------------------------

def generate_theme(name: str, g: dict) -> dict:
    bg = g.get("background", "#1e1e1e")
    fg = g.get("foreground", "#cccccc")
    cursor = g.get("cursor-color", fg)
    p = g.get("palette", {})

    # -- Palette extraction --
    black = p.get(0, "#000000")
    red = p.get(1, "#cc0000")
    green = p.get(2, "#4e9a06")
    yellow = p.get(3, "#c4a000")
    blue = p.get(4, "#3465a4")
    magenta = p.get(5, "#75507b")
    cyan = p.get(6, "#06989a")
    white = p.get(7, "#d3d7cf")
    bright_black = p.get(8, "#555753")
    bright_red = p.get(9, "#ef2929")
    bright_green = p.get(10, "#8ae234")
    bright_yellow = p.get(11, "#fce94f")
    bright_blue = p.get(12, "#729fcf")
    bright_magenta = p.get(13, "#ad7fa8")
    bright_cyan = p.get(14, "#34e2e2")
    bright_white = p.get(15, "#eeeeec")

    is_dark = luminance(bg) < 128

    # -- Accent selection --
    # Pattern from official themes: cursor if saturated + distinct, else most vivid
    all_saturated = [
        bright_red, bright_green, bright_yellow, bright_blue,
        bright_magenta, bright_cyan, red, green, yellow, blue, magenta, cyan,
    ]
    cursor_sat = saturation(cursor)
    cursor_distinct = (
        cursor != fg and cursor != bg
        and cursor_sat > 0.3
        and abs(luminance(cursor) - luminance(bg)) > 40
    )
    accent = cursor if cursor_distinct else max(
        all_saturated,
        key=lambda c: saturation(c) * (luminance(c) + 20) / 275,
    )

    # -- Gray / muted --
    # Official themes: gray = brightBlack (exact match in 6/10 themes)
    gray = bright_black
    if abs(luminance(gray) - luminance(bg)) < 25:
        gray = lighten(bg, 55) if is_dark else darken(bg, 55)
    gray = ensure_contrast(gray, bg, 35)

    # -- Comment (slightly brighter than gray for code readability) --
    comment = gray

    # -- Surface / dark backgrounds --
    # Pattern: black == bg -> lighten for surface; black != bg -> use black
    black_is_bg = color_dist(black, bg) < 15
    if is_dark:
        dark_bg = black if not black_is_bg else darken(bg, 12)
        surface = lighten(bg, 18) if black_is_bg else mix(bg, black, 0.5)
        dark_gray = lighten(bg, 15)
    else:
        dark_bg = lighten(bg, 8)
        surface = darken(bg, 12)
        dark_gray = darken(bg, 15)

    # -- White (for headings, bright text) --
    white_color = bright_white if luminance(bright_white) > 200 else fg
    if not is_dark:
        white_color = fg  # light themes use fg for "white" role

    # -- Orange (from yellow-red hue range, ~25-60 degrees) --
    orange_cands = [c for c in all_saturated if 20 < hue_angle(c) < 65]
    if orange_cands:
        orange = max(orange_cands, key=lambda c: saturation(c))
    else:
        orange = mix(red, yellow, 0.5)

    # -- Panel backgrounds (tinted toward semantic color) --
    panel_base = lighten(bg, 6) if is_dark else darken(bg, 4)
    panel = lighten(bg, 5) if is_dark else darken(bg, 3)
    panel_alt = lighten(bg, 8) if is_dark else darken(bg, 6)
    panel_success = mix(green, panel_base, 0.03)
    panel_error = mix(red, panel_base, 0.05)
    panel_info = lighten(bg, 10) if is_dark else darken(bg, 8)

    # -- Accent-error collision fix --
    if accent == red or (hue_distance(accent, red) < 10
                         and abs(luminance(accent) - luminance(red)) < 15):
        # Pick a non-red accent: first try saturated alternatives
        alt = [c for c in all_saturated
               if c != red and hue_distance(c, red) > 30
               and saturation(c) > 0.1
               and abs(luminance(c) - luminance(bg)) > 25]
        if not alt:
            # Relax: any color different from red with some contrast
            alt = [c for c in all_saturated
                   if c != red and color_dist(c, red) > 20
                   and abs(luminance(c) - luminance(bg)) > 20]
        if alt:
            accent = max(alt, key=lambda c: saturation(c) * (luminance(c) + 20) / 275)
        else:
            # Last resort: shift the accent hue away from red
            accent = lighten(accent, 40) if luminance(accent) <= 128 else darken(accent, 40)

    # -- Diff colors --
    diff_added = mix(green, fg, 0.38) if is_dark else green
    diff_removed = mix(red, fg, 0.42) if is_dark else red
    diff_context = mix(gray, fg, 0.18)

    # -- Accent derivations --
    accent_lum = luminance(accent)
    accent_dark = darken(accent, 50) if accent_lum > 70 else darken(accent, 25)
    accent_mid = mix(accent, fg, 0.5)

    # -- Secondary (distinct hue from accent, used for links/functions) --
    # Pattern from official: blue in 6/10 themes for syntaxFunction
    # Pick blue unless it IS the accent
    if hue_distance(blue, accent) > 30:
        secondary = blue
    elif hue_distance(cyan, accent) > 30:
        secondary = cyan
    else:
        sec_cands = [c for c in all_saturated
                     if hue_distance(c, accent) > 40
                     and abs(luminance(c) - luminance(bg)) > 35]
        secondary = max(sec_cands, key=lambda c: saturation(c)) if sec_cands else bright_cyan
    secondary = ensure_contrast(secondary, bg, 40)

    slug = slugify(name)

    return {
        "$schema": SCHEMA_URL,
        "name": slug,
        "vars": {
            "bg": bg,
            "fg": fg,
            "gray": gray,
            "darkGray": dark_gray,
            "accent": accent,
            "accentDark": accent_dark,
            "accentMid": accent_mid,
            "secondary": secondary,
            "white": white_color,
            "panel": panel,
            "panelAlt": panel_alt,
            "panelSuccess": panel_success,
            "panelError": panel_error,
            "panelInfo": panel_info,
            "success": green,
            "error": red,
            "warning": yellow,
            "orange": orange,
            "red": red,
            "green": green,
            "yellow": yellow,
            "blue": blue,
            "magenta": magenta,
            "cyan": cyan,
            "surface": surface,
            "darkBg": dark_bg,
            "comment": comment,
            "diffAdded": diff_added,
            "diffRemoved": diff_removed,
            "diffContext": diff_context,
        },
        "colors": {
            # -- Core UI --
            "accent": "accent",
            "border": "blue",           # 6/10 official themes use blue
            "borderAccent": "accent",
            "borderMuted": "darkGray",
            "success": "success",
            "error": "error",
            "warning": "warning",
            "muted": "comment",
            "dim": "comment",
            "text": "",                 # terminal default (10/10)
            "thinkingText": "comment",

            # -- Backgrounds --
            "selectedBg": "surface",
            "userMessageBg": "darkBg",
            "userMessageText": "",      # terminal default (10/10)
            "customMessageBg": "surface",
            "customMessageText": "",    # terminal default (10/10)
            "customMessageLabel": "magenta",  # 7/10 use purple/magenta
            "toolPendingBg": "panelAlt",
            "toolSuccessBg": "panelSuccess",
            "toolErrorBg": "panelError",
            "toolTitle": "",            # terminal default (10/10)
            "toolOutput": "comment",

            # -- Markdown --
            "mdHeading": "yellow",      # 9/10 themes
            "mdLink": "blue",           # 8/10 themes
            "mdLinkUrl": "comment",
            "mdCode": "cyan",           # 7/10 themes
            "mdCodeBlock": "green",     # 9/10 themes
            "mdCodeBlockBorder": "comment",
            "mdQuote": "comment",
            "mdQuoteBorder": "comment",
            "mdHr": "darkGray",
            "mdListBullet": "accent",

            # -- Diffs --
            "toolDiffAdded": "diffAdded",
            "toolDiffRemoved": "diffRemoved",
            "toolDiffContext": "diffContext",

            # -- Syntax highlighting --
            "syntaxComment": "comment",
            "syntaxKeyword": "accent",      # varies, but accent is common
            "syntaxFunction": "secondary",  # blue in 6/10
            "syntaxVariable": "fg",         # 4/10 themes (safe default)
            "syntaxString": "green",        # 4/10 themes
            "syntaxNumber": "magenta",      # purple/magenta in 5/10
            "syntaxType": "yellow",         # 7/10 themes
            "syntaxOperator": "orange",     # varies, orange common
            "syntaxPunctuation": "gray",

            # -- Thinking progression (dark to bright) --
            "thinkingOff": "darkGray",
            "thinkingMinimal": "comment",
            "thinkingLow": "blue",          # normal blue (palette[4])
            "thinkingMedium": "secondary",
            "thinkingHigh": "accent",
            "thinkingXhigh": "red",         # 4/10 use red

            "bashMode": "green",            # 7/10 themes
        },
        "export": {
            "pageBg": bg,
            "cardBg": panel,
            "infoBg": panel_info,
        },
    }


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_themes() -> bool:
    errors = []
    for f in sorted(OUTPUT_DIR.iterdir()):
        if not f.name.endswith(".json"):
            continue
        theme = json.loads(f.read_text())
        vars_map = theme.get("vars", {})
        name = theme.get("name", f.name)
        accent = vars_map.get("accent", "")
        error_color = vars_map.get("error", "")
        if accent and error_color and accent == error_color:
            errors.append((name, ["accent identical to error"]))

    count = sum(1 for f in OUTPUT_DIR.iterdir() if f.name.endswith(".json"))
    if errors:
        print(f"{len(errors)} theme(s) with errors:")
        for name, probs in errors:
            print(f"  FAIL {name}: {', '.join(probs)}")
        return False
    print(f"All {count} themes pass")
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate pi themes from iTerm2 color schemes")
    parser.add_argument("--name", nargs="+", help="Generate only named theme(s)")
    parser.add_argument("--validate", action="store_true", help="Validate existing themes")
    parser.add_argument("--schemes-dir", type=pathlib.Path, default=SCHEMES_DIR)
    args = parser.parse_args()

    if args.validate:
        raise SystemExit(0 if validate_themes() else 1)

    names = args.name if args.name else load_curated()
    schemes_dir = args.schemes_dir

    if not schemes_dir.is_dir():
        print(f"Schemes directory not found: {schemes_dir}")
        print("Run: bash scripts/fetch-upstream.sh")
        raise SystemExit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    generated = []
    for name in names:
        iterm_path = schemes_dir / f"{name}.itermcolors"
        if not iterm_path.exists():
            print(f"SKIP: {name} (not found at {iterm_path})")
            continue
        g = parse_itermcolors(iterm_path)
        theme = generate_theme(name, g)
        slug = slugify(name)
        out = OUTPUT_DIR / f"{slug}.json"
        out.write_text(json.dumps(theme, indent=2) + "\n")
        generated.append(name)
        print(f"OK: {name} -> {slug}.json")

    print(f"\nGenerated {len(generated)} theme(s)")
    print()
    validate_themes()


if __name__ == "__main__":
    main()
