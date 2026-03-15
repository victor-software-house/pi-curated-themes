#!/usr/bin/env python3
"""Generate pi semantic themes from iTerm2 .itermcolors files.

Reads the curated list from curated.toml, parses .itermcolors XML plists,
derives pi theme vars, stamps the static colors template, and writes JSON.

Usage:
    python3 scripts/generate-pi-themes.py                  # generate all
    python3 scripts/generate-pi-themes.py --name "Gruvbox Dark"  # generate one
    python3 scripts/generate-pi-themes.py --validate        # check only
"""
from __future__ import annotations

import argparse
import colorsys
import json
import math
import os
import pathlib
import plistlib
import re
import sys

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # Python < 3.11

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
CURATED_PATH = REPO_ROOT / "curated.toml"
SCHEMES_DIR = REPO_ROOT / ".upstream" / "iTerm2-Color-Schemes" / "schemes"
OUTPUT_DIR = REPO_ROOT / "themes"
SCHEMA_URL = "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json"

# ──────────────────────────────────────────────────────────────────────────────
# Color helpers
# ──────────────────────────────────────────────────────────────────────────────

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
    return h * 60


def hue_distance(c1: str, c2: str) -> float:
    h1, h2 = hue_angle(c1), hue_angle(c2)
    d = abs(h1 - h2)
    return min(d, 360 - d)


def tint_toward(base: str, tint: str, strength: float = 0.08) -> str:
    return mix(tint, base, strength)


def ensure_contrast(fg: str, bg: str, min_diff: int = 45) -> str:
    fl, bl = luminance(fg), luminance(bg)
    if abs(fl - bl) >= min_diff:
        return fg
    needed = int(min_diff - abs(fl - bl))
    return lighten(fg, needed) if bl < 128 else darken(fg, needed)


# ──────────────────────────────────────────────────────────────────────────────
# P3 -> sRGB conversion (matches upstream gen.py)
# ──────────────────────────────────────────────────────────────────────────────

def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c < 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c: float) -> float:
    return 12.92 * c if c < 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def p3_to_srgb(r: float, g: float, b: float) -> tuple[float, float, float]:
    """Convert Display P3 float RGB to sRGB float RGB."""
    rl = _srgb_to_linear(r)
    gl = _srgb_to_linear(g)
    bl = _srgb_to_linear(b)
    # P3 to XYZ
    x = 0.4865709486 * rl + 0.2656676932 * gl + 0.1982172852 * bl
    y = 0.2289745641 * rl + 0.6917385218 * gl + 0.0792869141 * bl
    z = 0.0000000000 * rl + 0.0451133819 * gl + 1.0439443689 * bl
    # XYZ to sRGB
    sr = 3.2404541621 * x - 1.5371385940 * y - 0.4985314096 * z
    sg = -0.9692660305 * x + 1.8760108454 * y + 0.0415560175 * z
    sb = 0.0556434309 * x - 0.2040259135 * y + 1.0572251882 * z
    return (
        max(0.0, min(1.0, _linear_to_srgb(sr))),
        max(0.0, min(1.0, _linear_to_srgb(sg))),
        max(0.0, min(1.0, _linear_to_srgb(sb))),
    )


# ──────────────────────────────────────────────────────────────────────────────
# .itermcolors parser
# ──────────────────────────────────────────────────────────────────────────────

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
    """Parse .itermcolors XML plist into the same dict format as the old Ghostty parser."""
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


# ──────────────────────────────────────────────────────────────────────────────
# Curated list
# ──────────────────────────────────────────────────────────────────────────────

def load_curated() -> list[str]:
    with open(CURATED_PATH, "rb") as f:
        data = tomllib.load(f)
    return data.get("themes", [])


def slugify(name: str) -> str:
    s = name.lower()
    s = s.replace("+", "-plus")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


# ──────────────────────────────────────────────────────────────────────────────
# Theme generation (same heuristics as pi-ghostty-themes)
# ──────────────────────────────────────────────────────────────────────────────

def generate_theme(name: str, g: dict) -> dict:
    bg = g.get("background", "#1e1e1e")
    fg = g.get("foreground", "#cccccc")
    cursor = g.get("cursor-color", fg)
    p = g.get("palette", {})

    ansi = {i: p.get(i, "#555555") for i in range(16)}
    red, green, yellow = ansi[1], ansi[2], ansi[3]
    blue, magenta, cyan, white = ansi[4], ansi[5], ansi[6], ansi[7]
    bright_black = ansi[8]
    bright_red, bright_green, bright_yellow = ansi[9], ansi[10], ansi[11]
    bright_blue, bright_magenta, bright_cyan = ansi[12], ansi[13], ansi[14]
    bright_white = ansi[15]
    all_colors = [ansi[i] for i in range(16)]

    # ── Accent ──
    cursor_sat = saturation(cursor)
    if cursor_sat > 0.3 and cursor != fg and cursor != bg and luminance(cursor) > 40:
        accent = cursor
    else:
        candidates = [bright_red, bright_green, bright_yellow, bright_blue,
                      bright_magenta, bright_cyan, red, green, yellow, blue, magenta, cyan]
        accent = max(candidates, key=lambda c: saturation(c) * (luminance(c) + 20) / 275)

    # ── Success / Error / Warning (distinct hue families) ──
    all_saturated = [c for c in all_colors if saturation(c) > 0.12
                     and abs(luminance(c) - luminance(bg)) > 25]

    # Error: red family (hue < 30 or > 330)
    error_cands = [c for c in all_saturated if hue_angle(c) < 30 or hue_angle(c) > 330]
    if not error_cands:
        error_cands = [c for c in all_saturated if hue_angle(c) < 45 or hue_angle(c) > 315]
    if not error_cands:
        error_cands = [red, bright_red]
    error_color = max(error_cands, key=lambda c: saturation(c) * luminance(c))
    error_color = ensure_contrast(error_color, bg, 50)

    # Success: green/teal (hue 80-200)
    success_cands = [c for c in all_saturated if 80 < hue_angle(c) < 200
                     and hue_distance(c, error_color) > 60]
    if not success_cands:
        success_cands = [c for c in all_saturated if 140 < hue_angle(c) < 240
                         and hue_distance(c, error_color) > 50]
    if not success_cands:
        success_cands = [c for c in [green, bright_green, cyan, bright_cyan] if saturation(c) > 0.05]
    if not success_cands:
        success_cands = [mix("#5faf5f", fg, 0.6)]
    success_color = max(success_cands, key=lambda c: saturation(c) * (luminance(c) + 20) / 275)
    success_color = ensure_contrast(success_color, bg, 45)

    # Warning: yellow/amber (hue 30-80)
    warning_cands = [c for c in all_saturated if 25 < hue_angle(c) < 85
                     and hue_distance(c, error_color) > 30
                     and hue_distance(c, success_color) > 30]
    if not warning_cands:
        warning_cands = [c for c in all_saturated if 20 < hue_angle(c) < 100
                         and hue_distance(c, error_color) > 20
                         and hue_distance(c, success_color) > 20]
    if not warning_cands:
        warning_cands = [c for c in [yellow, bright_yellow] if saturation(c) > 0.05]
    if not warning_cands:
        warning_cands = [mix("#d7af5f", fg, 0.6)]
    warning_color = max(warning_cands, key=lambda c: saturation(c) * (luminance(c) + 20) / 275)
    warning_color = ensure_contrast(warning_color, bg, 45)

    # Semantic hue enforcement
    eh = hue_angle(error_color)
    if not (eh < 50 or eh > 320):
        error_color = ensure_contrast(mix("#d75f5f", fg, 0.55), bg, 50)
    sh = hue_angle(success_color)
    if not (80 < sh < 200):
        success_color = ensure_contrast(mix("#5faf5f", fg, 0.55), bg, 45)
    wh = hue_angle(warning_color)
    if not (20 < wh < 90):
        warning_color = ensure_contrast(mix("#d7af5f", fg, 0.55), bg, 45)

    # Pairwise distinctness (25+ degrees)
    if hue_distance(warning_color, error_color) < 25:
        warning_color = ensure_contrast(mix("#cccc00", fg, 0.50), bg, 45)
    if hue_distance(warning_color, success_color) < 25:
        warning_color = ensure_contrast(mix("#cccc00", fg, 0.55), bg, 45)
    if hue_distance(success_color, error_color) < 40:
        success_color = ensure_contrast(mix("#5faf5f", fg, 0.55), bg, 45)

    err_h = hue_angle(error_color)
    for attempt in range(6):
        ew = hue_distance(warning_color, error_color)
        sw = hue_distance(warning_color, success_color)
        if ew >= 25 and sw >= 25:
            break
        target = "#888800" if 25 < err_h < 55 else "#999900"
        ratio = 0.70 + attempt * 0.06
        warning_color = ensure_contrast(mix(target, fg, min(ratio, 0.92)), bg, 45)

    if hue_distance(warning_color, error_color) < 25 or hue_distance(warning_color, success_color) < 25:
        best_warn = None
        for try_hue in [60, 55, 65, 50, 70, 45, 75]:
            r_f, g_f, b_f = colorsys.hls_to_rgb(try_hue / 360, 0.55, 0.65)
            candidate = ensure_contrast(rgb_to_hex(r_f * 255, g_f * 255, b_f * 255), bg, 45)
            if hue_distance(candidate, error_color) >= 25 and hue_distance(candidate, success_color) >= 25:
                best_warn = candidate
                break
        warning_color = best_warn or ensure_contrast("#c8a832", bg, 45)

    # ── Secondary accent ──
    sec_cands = [c for c in all_saturated if hue_distance(c, accent) > 40
                 and abs(luminance(c) - luminance(bg)) > 35]
    secondary = max(sec_cands, key=lambda c: saturation(c)) if sec_cands else (
        bright_cyan if bright_cyan != accent else bright_magenta)
    secondary = ensure_contrast(secondary, bg, 45)

    if hue_distance(secondary, error_color) < 30:
        alt = [c for c in all_saturated if hue_distance(c, accent) > 30
               and hue_distance(c, error_color) > 30 and abs(luminance(c) - luminance(bg)) > 35]
        secondary = ensure_contrast(max(alt, key=lambda c: saturation(c)), bg, 45) if alt else ensure_contrast(mix("#5fafcf", fg, 0.55), bg, 45)

    # ── Grays ──
    gray = bright_black if luminance(bright_black) > luminance(bg) + 25 else lighten(bg, 55)
    gray = ensure_contrast(gray, bg, 40)
    dim = ensure_contrast(gray, bg, 45)
    dark_gray = lighten(bg, 15)
    white_color = bright_white if luminance(bright_white) > 200 else "#f5f5f5"

    # ── Panels ──
    panel = lighten(bg, 5)
    panel_alt = lighten(bg, 8)
    panel_success = tint_toward(lighten(bg, 6), success_color, 0.07)
    panel_error = tint_toward(lighten(bg, 6), error_color, 0.10)
    panel_info = lighten(bg, 10)

    # ── Fix accent if identical to error ──
    if accent == error_color or (hue_distance(accent, error_color) < 10
                                  and abs(luminance(accent) - luminance(error_color)) < 15):
        alt = [c for c in all_saturated if c != error_color
               and abs(luminance(c) - luminance(error_color)) > 20
               and saturation(c) > 0.2 and abs(luminance(c) - luminance(bg)) > 35]
        if alt:
            accent = max(alt, key=lambda c: saturation(c) * (luminance(c) + 20) / 275)
        else:
            accent = lighten(accent, 40) if luminance(accent) <= 128 else darken(accent, 40)
        accent = ensure_contrast(accent, bg, 45)

    # ── Diffs ──
    diff_added = mix(success_color, fg, 0.7) if luminance(success_color) > 150 else success_color
    diff_added = ensure_contrast(diff_added, bg, 45)
    diff_removed = mix(error_color, fg, 0.7) if luminance(error_color) > 150 else error_color
    diff_removed = ensure_contrast(diff_removed, bg, 45)

    # ── Thinking progression ──
    accent_lum = luminance(accent)

    slug = slugify(name)

    return {
        "$schema": SCHEMA_URL,
        "name": f"{slug}-semantic",
        "vars": {
            "bg": bg,
            "fg": fg,
            "gray": gray,
            "darkGray": dark_gray,
            "accent": accent,
            "accentDark": darken(accent, 50) if accent_lum > 70 else darken(accent, 25),
            "accentMid": mix(accent, fg, 0.5),
            "secondary": secondary,
            "white": white_color,
            "panel": panel,
            "panelAlt": panel_alt,
            "panelSuccess": panel_success,
            "panelError": panel_error,
            "panelInfo": panel_info,
            "success": success_color,
            "error": error_color,
            "warning": warning_color,
            "diffAdded": diff_added,
            "diffRemoved": diff_removed,
        },
        "colors": {
            "accent": "accent",
            "border": "gray",
            "borderAccent": "accent",
            "borderMuted": "darkGray",
            "success": "success",
            "error": "error",
            "warning": "warning",
            "muted": "gray",
            "dim": "gray",
            "text": "",
            "thinkingText": "gray",
            "selectedBg": "panelInfo",
            "userMessageBg": "panel",
            "userMessageText": "",
            "customMessageBg": "panelAlt",
            "customMessageText": "",
            "customMessageLabel": "accent",
            "toolPendingBg": "panelAlt",
            "toolSuccessBg": "panelSuccess",
            "toolErrorBg": "panelError",
            "toolTitle": "white",
            "toolOutput": "fg",
            "mdHeading": "white",
            "mdLink": "secondary",
            "mdLinkUrl": "gray",
            "mdCode": "accent",
            "mdCodeBlock": "fg",
            "mdCodeBlockBorder": "accentDark",
            "mdQuote": "gray",
            "mdQuoteBorder": "gray",
            "mdHr": "darkGray",
            "mdListBullet": "accent",
            "toolDiffAdded": "diffAdded",
            "toolDiffRemoved": "diffRemoved",
            "toolDiffContext": "gray",
            "syntaxComment": "gray",
            "syntaxKeyword": "accent",
            "syntaxFunction": "secondary",
            "syntaxVariable": "fg",
            "syntaxString": "success",
            "syntaxNumber": "warning",
            "syntaxType": "white",
            "syntaxOperator": "error",
            "syntaxPunctuation": "gray",
            "thinkingOff": "darkGray",
            "thinkingMinimal": "gray",
            "thinkingLow": "accentDark",
            "thinkingMedium": "accentMid",
            "thinkingHigh": "accent",
            "thinkingXhigh": "white",
            "bashMode": "accent",
        },
        "export": {
            "pageBg": bg,
            "cardBg": panel,
            "infoBg": panel_info,
        },
    }


# ──────────────────────────────────────────────────────────────────────────────
# Validation
# ──────────────────────────────────────────────────────────────────────────────

SEMANTIC_HUE_MIN = 25
BASE_NEUTRAL_CONTRAST_HARD = 35
BASE_NEUTRAL_CONTRAST_WARN = 42
PANEL_NEUTRAL_CONTRAST_HARD = 28
PANEL_NEUTRAL_CONTRAST_WARN = 35
TINTED_PANEL_NEUTRAL_CONTRAST_HARD = 18
TINTED_PANEL_NEUTRAL_CONTRAST_WARN = 30
TEXT_ON_PANEL_CONTRAST_HARD = 45
TEXT_ON_PANEL_CONTRAST_WARN = 60


VALIDATION_PAIRS = [
    {
        "id": "base-muted",
        "fg": "muted",
        "bg": "bg",
        "hard": BASE_NEUTRAL_CONTRAST_HARD,
        "warn": BASE_NEUTRAL_CONTRAST_WARN,
    },
    {
        "id": "thinking-text",
        "fg": "thinkingText",
        "bg": "bg",
        "hard": BASE_NEUTRAL_CONTRAST_HARD,
        "warn": BASE_NEUTRAL_CONTRAST_WARN,
    },
    {
        "id": "md-link-url-on-base",
        "fg": "mdLinkUrl",
        "bg": "bg",
        "hard": BASE_NEUTRAL_CONTRAST_HARD,
        "warn": BASE_NEUTRAL_CONTRAST_WARN,
    },
    {
        "id": "md-quote-on-base",
        "fg": "mdQuote",
        "bg": "bg",
        "hard": BASE_NEUTRAL_CONTRAST_HARD,
        "warn": BASE_NEUTRAL_CONTRAST_WARN,
    },
    {
        "id": "user-message-text",
        "fg": "userMessageText",
        "bg": "userMessageBg",
        "hard": TEXT_ON_PANEL_CONTRAST_HARD,
        "warn": TEXT_ON_PANEL_CONTRAST_WARN,
    },
    {
        "id": "custom-message-text",
        "fg": "customMessageText",
        "bg": "customMessageBg",
        "hard": TEXT_ON_PANEL_CONTRAST_HARD,
        "warn": TEXT_ON_PANEL_CONTRAST_WARN,
    },
    {
        "id": "tool-output-pending",
        "fg": "toolOutput",
        "bg": "toolPendingBg",
        "hard": TEXT_ON_PANEL_CONTRAST_HARD,
        "warn": TEXT_ON_PANEL_CONTRAST_WARN,
    },
    {
        "id": "tool-output-success",
        "fg": "toolOutput",
        "bg": "toolSuccessBg",
        "hard": TEXT_ON_PANEL_CONTRAST_HARD,
        "warn": TEXT_ON_PANEL_CONTRAST_WARN,
    },
    {
        "id": "tool-output-error",
        "fg": "toolOutput",
        "bg": "toolErrorBg",
        "hard": TEXT_ON_PANEL_CONTRAST_HARD,
        "warn": TEXT_ON_PANEL_CONTRAST_WARN,
    },
    {
        "id": "tool-diff-context-pending",
        "fg": "toolDiffContext",
        "bg": "toolPendingBg",
        "hard": PANEL_NEUTRAL_CONTRAST_HARD,
        "warn": PANEL_NEUTRAL_CONTRAST_WARN,
    },
    {
        "id": "tool-diff-context-success",
        "fg": "toolDiffContext",
        "bg": "toolSuccessBg",
        "hard": TINTED_PANEL_NEUTRAL_CONTRAST_HARD,
        "warn": TINTED_PANEL_NEUTRAL_CONTRAST_WARN,
    },
    {
        "id": "tool-diff-context-error",
        "fg": "toolDiffContext",
        "bg": "toolErrorBg",
        "hard": TINTED_PANEL_NEUTRAL_CONTRAST_HARD,
        "warn": TINTED_PANEL_NEUTRAL_CONTRAST_WARN,
    },
]


def resolve_color(theme: dict, token: str) -> str | None:
    vars_map = theme.get("vars", {})
    colors_map = theme.get("colors", {})
    if token in vars_map:
        return vars_map.get(token)
    if token == "bg":
        return vars_map.get("bg")
    color_ref = colors_map.get(token)
    if color_ref == "":
        return vars_map.get("fg")
    if isinstance(color_ref, str):
        return vars_map.get(color_ref)
    return None


def validate_surface_pair(theme: dict, pair: dict) -> tuple[str, float] | None:
    fg_value = resolve_color(theme, pair["fg"])
    bg_value = resolve_color(theme, pair["bg"])
    if not fg_value or not bg_value:
        return None
    contrast = abs(luminance(fg_value) - luminance(bg_value))
    return f"{pair['fg']} on {pair['bg']}", contrast



def validate_themes() -> bool:
    errors = []
    warnings = []
    theme_dir = OUTPUT_DIR
    for f in sorted(theme_dir.iterdir()):
        if not f.name.endswith("-semantic.json"):
            continue
        theme = json.loads(f.read_text())
        vars_map = theme.get("vars", {})
        name = theme.get("name", f.name)
        success_color = vars_map.get("success", "")
        error_color = vars_map.get("error", "")
        warning_color = vars_map.get("warning", "")
        accent = vars_map.get("accent", "")

        err_list: list[str] = []
        warn_list: list[str] = []

        if success_color and error_color and hue_distance(success_color, error_color) < SEMANTIC_HUE_MIN:
            err_list.append(
                f"success-error hue={hue_distance(success_color, error_color):.0f}deg (<{SEMANTIC_HUE_MIN})"
            )
        if success_color and warning_color and hue_distance(success_color, warning_color) < SEMANTIC_HUE_MIN:
            err_list.append(
                f"success-warning hue={hue_distance(success_color, warning_color):.0f}deg (<{SEMANTIC_HUE_MIN})"
            )
        if error_color and warning_color and hue_distance(error_color, warning_color) < SEMANTIC_HUE_MIN:
            err_list.append(
                f"error-warning hue={hue_distance(error_color, warning_color):.0f}deg (<{SEMANTIC_HUE_MIN})"
            )

        if accent and error_color and accent == error_color:
            err_list.append("accent identical to error")

        for pair in VALIDATION_PAIRS:
            result = validate_surface_pair(theme, pair)
            if result is None:
                continue
            pair_label, contrast = result
            if contrast < pair["hard"]:
                err_list.append(f"{pair_label} contrast {contrast:.0f} (<{pair['hard']})")
            elif contrast < pair["warn"]:
                warn_list.append(f"{pair_label} contrast {contrast:.0f} (<{pair['warn']})")

        if err_list:
            errors.append((name, err_list))
        if warn_list:
            warnings.append((name, warn_list))

    count = sum(1 for f in theme_dir.iterdir() if f.name.endswith("-semantic.json"))

    if warnings:
        print(f"{len(warnings)} theme(s) with warnings:")
        for name, probs in warnings:
            print(f"  WARN {name}: {', '.join(probs)}")
        print()

    if errors:
        print(f"{len(errors)} theme(s) with errors:")
        for name, probs in errors:
            print(f"  FAIL {name}: {', '.join(probs)}")
        return False

    status = "pass" if not warnings else "pass (with warnings)"
    print(f"All {count} semantic themes {status}")
    return True


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate pi semantic themes from iTerm2 color schemes")
    parser.add_argument("--name", nargs="+", help="Generate only named theme(s). Omit for all curated.")
    parser.add_argument("--validate", action="store_true", help="Validate existing themes without regenerating.")
    parser.add_argument("--schemes-dir", type=pathlib.Path, default=SCHEMES_DIR,
                        help="Path to iTerm2-Color-Schemes/schemes/ directory.")
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
        out = OUTPUT_DIR / f"{slug}-semantic.json"
        out.write_text(json.dumps(theme, indent=2) + "\n")
        generated.append(name)
        print(f"OK: {name} -> {slug}-semantic.json")

    print(f"\nGenerated {len(generated)} theme(s)")
    print()
    validate_themes()


if __name__ == "__main__":
    main()
