#!/usr/bin/env -S bun --install=force

import { readFileSync } from "node:fs";
import "zod/v3";

import {
  Key,
  matchesKey,
  ProcessTerminal,
  SelectList,
  type SelectItem,
  TUI,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@mariozechner/pi-tui";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  CustomMessageComponent,
  DynamicBorder,
  getMarkdownTheme,
  getSelectListTheme,
  initTheme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@mariozechner/pi-coding-agent";

type ThemeMode = "dark" | "light" | "all";

type OriginalTerminalTheme = {
  foreground: string;
  background: string;
  cursor: string;
  palette: string[];
};

type ThemeRecord = {
  name: string;
  path: string;
  sourceName: string;
  sourcePath: string;
  background: string;
  pageBg: string;
  isDark: boolean;
  originalTerminalTheme?: OriginalTerminalTheme;
};

const SCRIPT_DIR = import.meta.dir;
const REPO_ROOT = `${SCRIPT_DIR}/..`;
const THEMES_DIR = `${REPO_ROOT}/themes`;
const UPSTREAM_SCHEMES_DIR = `${REPO_ROOT}/.upstream/iTerm2-Color-Schemes/schemes`;
const CURATED_TOML_PATH = `${REPO_ROOT}/curated.toml`;
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const DEFAULT_MODE: ThemeMode = parseMode(Bun.argv[2]);
let terminalCleanedUp = false;

class ThemeBrowser implements Component {
  private readonly tui: TUI;
  private readonly allThemes: ThemeRecord[];
  private mode: ThemeMode;
  private helpMode = false;
  private searchMode = false;
  private searchQuery = "";
  private items: SelectItem[] = [];
  private listVisibleRows = 18;
  private list: SelectList;
  private selectedTheme?: ThemeRecord;
  private previewComponents: Component[] = [];
  private previewWidth = 72;

  constructor(tui: TUI, themes: ThemeRecord[], mode: ThemeMode) {
    this.tui = tui;
    this.allThemes = themes;
    this.mode = mode;
    this.list = this.createSelectList([], this.listVisibleRows);
    this.resetItems();
  }

  invalidate(): void {
    this.list.invalidate();
    for (const component of this.previewComponents) {
      component.invalidate?.();
    }
  }

  handleInput(data: string): void {
    if (this.helpMode) {
      if (matchesKey(data, Key.escape) || data === "?" || matchesKey(data, Key.f1) || matchesKey(data, Key.ctrl("h"))) {
        this.helpMode = false;
        this.tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.ctrl("c")) || data === "q" || data === "Q") {
        this.tui.stop();
        cleanupTerminal();
        process.exit(0);
      }
      return;
    }

    if (this.searchMode) {
      this.handleSearchInput(data);
      return;
    }

    if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.tui.stop();
      cleanupTerminal();
      process.exit(0);
    }

    if (data === "?" || matchesKey(data, Key.f1) || matchesKey(data, Key.ctrl("h"))) {
      this.helpMode = true;
      this.tui.requestRender();
      return;
    }

    if (data === "/") {
      this.searchMode = true;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.ctrl("x")) || matchesKey(data, Key.ctrl("/"))) {
      this.searchQuery = "";
      this.resetItems();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.tab) || data === "f" || data === "F") {
      this.cycleMode();
      return;
    }

    if (matchesKey(data, "home")) {
      this.list.setSelectedIndex(0);
      this.selectThemeByIndex(0);
      return;
    }

    if (matchesKey(data, "end")) {
      const last = Math.max(0, this.items.length - 1);
      this.list.setSelectedIndex(last);
      this.selectThemeByIndex(last);
      return;
    }

    if (matchesKey(data, "page_down")) {
      this.moveSelection(20);
      return;
    }

    if (matchesKey(data, "page_up")) {
      this.moveSelection(-20);
      return;
    }

    if (data === "j" || data === "+") {
      this.list.handleInput("\x1b[B");
      this.tui.requestRender();
      return;
    }

    if (data === "k" || data === "-") {
      this.list.handleInput("\x1b[A");
      this.tui.requestRender();
      return;
    }

    this.list.handleInput(data);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const separator = " │ ";
    const totalRows = Math.max(8, this.tui.terminal.rows);
    const bodyRows = Math.max(6, totalRows - 1);
    const leftWidth = Math.max(24, Math.min(32, Math.floor(width * 0.26)));
    const rightWidth = Math.max(36, width - leftWidth - visibleWidth(separator));
    this.previewWidth = rightWidth;
    this.ensureListVisibleRows(bodyRows);

    const leftLines = this.renderThemeList(leftWidth, bodyRows);
    const rightLines = padToRows(this.renderPreview(rightWidth), bodyRows, this.getPreviewFiller(rightWidth));
    let body = joinColumns(leftLines, rightLines, leftWidth, separator, rightWidth);
    if (this.helpMode) {
      body = overlayLines(body, buildHelpOverlay(width, bodyRows));
    }
    const footer = this.renderFooter(width);

    return [...body, footer];
  }

  private renderPreview(width: number): string[] {
    if (!this.selectedTheme) {
      return [padVisible(centerText("No theme selected", width), width)];
    }

    const lines: string[] = [];
    const nameLine = centerText(this.selectedTheme.name, width);
    const pathLine = centerText(relativeThemePath(this.selectedTheme.sourcePath), width);
    const metaLine = centerText(`mode:${this.mode}  themes:${this.items.length}`, width);
    const sectionBorder = new DynamicBorder();

    lines.push(nameLine, pathLine, metaLine);

    for (let index = 0; index < this.previewComponents.length; index++) {
      if (index > 0) {
        lines.push(...sectionBorder.render(width));
      }
      const rendered = this.previewComponents[index].render(width);
      lines.push(...(index === 0 ? trimLeadingEmptyLines(rendered) : rendered));
    }

    return lines.map((line) => truncateToWidth(line, width));
  }

  private renderThemeList(width: number, rows: number): string[] {
    const lines = this.list.render(width).map((line) => truncateToWidth(line, width));
    return padToRows(lines, rows, "");
  }

  private renderFooter(width: number): string {
    const search = this.searchMode
      ? `/ ${this.searchQuery}`
      : this.searchQuery
        ? `filter:${this.searchQuery}`
        : `filter:${this.mode}`;
    const help = this.helpMode
      ? "esc/? close help"
      : this.searchMode
        ? "enter/esc close  ctrl+x clear"
        : "j/k move  pgup/pgdn jump  / search  ? help  f filter  q quit";
    return padVisible(truncateToWidth(`${search}  ${help}`, width), width);
  }

  private handleSearchInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
      this.searchMode = false;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.ctrl("x")) || matchesKey(data, Key.ctrl("/"))) {
      this.searchQuery = "";
      this.resetItems();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "backspace")) {
      this.searchQuery = this.searchQuery.slice(0, -1);
      this.resetItems();
      this.tui.requestRender();
      return;
    }

    if (data.length === 1 && data >= " ") {
      this.searchQuery += data;
      this.resetItems();
      this.tui.requestRender();
    }
  }

  private moveSelection(delta: number): void {
    const currentIndex = Math.max(0, this.items.findIndex((item) => item.value === this.selectedTheme?.name));
    const nextIndex = Math.max(0, Math.min(this.items.length - 1, currentIndex + delta));
    this.list.setSelectedIndex(nextIndex);
    this.selectThemeByIndex(nextIndex);
  }

  private selectThemeByIndex(index: number): void {
    const item = this.items[index];
    if (!item) {
      return;
    }
    const theme = this.findTheme(item.value);
    if (theme) {
      this.setTheme(theme);
      this.tui.requestRender();
    }
  }

  private cycleMode(): void {
    const nextMode: Record<ThemeMode, ThemeMode> = {
      dark: "light",
      light: "all",
      all: "dark",
    };
    this.mode = nextMode[this.mode];
    this.resetItems();
    this.tui.requestRender();
  }

  private createSelectList(items: SelectItem[], maxVisible: number): SelectList {
    const list = new SelectList(items, maxVisible, getSelectListTheme());
    list.onSelectionChange = (item) => {
      const theme = this.findTheme(item.value);
      if (theme) {
        this.setTheme(theme);
      }
    };
    list.onSelect = list.onSelectionChange;
    return list;
  }

  private ensureListVisibleRows(visibleRows: number): void {
    if (visibleRows === this.listVisibleRows) {
      return;
    }

    this.listVisibleRows = visibleRows;
    const selectedIndex = Math.max(0, this.items.findIndex((item) => item.value === this.selectedTheme?.name));
    this.list = this.createSelectList(this.items, this.listVisibleRows);
    this.list.setSelectedIndex(selectedIndex);
  }

  private resetItems(): void {
    const currentName = this.selectedTheme?.name;
    const filteredThemes = this.getThemesForMode();
    this.items = filteredThemes.map((theme) => ({
      value: theme.name,
      label: theme.name,
    }));

    this.list = this.createSelectList(this.items, this.listVisibleRows);

    const nextTheme =
      (currentName ? filteredThemes.find((theme) => theme.name === currentName) : undefined) ?? filteredThemes[0];

    if (nextTheme) {
      this.list.setSelectedIndex(Math.max(0, filteredThemes.findIndex((theme) => theme.name === nextTheme.name)));
      this.setTheme(nextTheme);
    }
  }

  private getThemesForMode(): ThemeRecord[] {
    const byMode = (() => {
      switch (this.mode) {
        case "dark":
          return this.allThemes.filter((theme) => theme.isDark);
        case "light":
          return this.allThemes.filter((theme) => !theme.isDark);
        case "all":
          return this.allThemes;
      }
    })();

    const query = this.searchQuery.trim().toLowerCase();
    if (!query) {
      return byMode;
    }

    const tokens = query.split(/\s+/).filter(Boolean);
    return byMode.filter((theme) => tokens.every((token) => theme.name.toLowerCase().includes(token)));
  }

  private findTheme(name: string): ThemeRecord | undefined {
    return this.allThemes.find((theme) => theme.name === name);
  }

  private setTheme(theme: ThemeRecord): void {
    if (this.selectedTheme?.name === theme.name && this.previewComponents.length > 0) {
      return;
    }

    process.env[AGENT_DIR_ENV] = REPO_ROOT;
    process.env.COLORTERM = process.env.COLORTERM || "truecolor";
    if (!theme.originalTerminalTheme) {
      theme.originalTerminalTheme = loadOriginalTerminalTheme(theme.sourcePath);
    }
    applyTerminalTheme(theme.originalTerminalTheme);
    initTheme(theme.name);

    this.selectedTheme = theme;
    if (this.previewComponents.length === 0) {
      this.previewComponents = buildPreviewComponents(this.tui, this.previewWidth);
    }
    this.invalidate();
    this.tui.requestRender();
  }

  private getPreviewFiller(width: number): string {
    return this.selectedTheme ? bgLine(this.selectedTheme.pageBg, width) : "";
  }
}

function buildPreviewComponents(tui: TUI, width: number): Component[] {
  const markdownTheme = getMarkdownTheme();

  const user = new UserMessageComponent(
    "Summarize the validation warnings and show the weakest contrast pairs.",
    markdownTheme,
  );

  const assistant = new AssistantMessageComponent(
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "Comparing dim and gray against the rendered panel surfaces before finalizing the report.",
        },
        {
          type: "text",
          text: "I found three low-contrast gray cases. The warning threshold is working, and the preview shows the actual surfaces used by pi.",
        },
      ],
    },
    false,
    markdownTheme,
  );

  const custom = new CustomMessageComponent(
    {
      customType: "theme-preview",
      content: "Using real pi components: user message, assistant message, custom message, bash output, successful tool, and failing tool.",
    },
    undefined,
    markdownTheme,
  );

  const bash = new BashExecutionComponent("python scripts/generate-pi-themes.py", tui);
  bash.appendOutput("Generated 65 semantic themes\n");
  bash.appendOutput("WARN later-this-evening-semantic: dim/gray contrast 39 (<42)\n");
  bash.appendOutput("All 65 semantic themes pass (with warnings)\n");
  bash.setComplete(0, false);

  const codeTool = new ToolExecutionComponent(
    "read",
    { path: "src/ziggzagg.rs", offset: 1, limit: 18 },
    {},
    undefined,
    tui,
    REPO_ROOT,
  );
  codeTool.setArgsComplete();
  codeTool.updateResult(
    {
      isError: false,
      content: [
        {
          type: "text",
          text: [
            'const std = @import("std");',
            '',
            'pub fn main() !void {',
            '    const stdout = std.io.getStdOut().writer();',
            '    var i: usize = 1;',
            '',
            '    while (i <= 100) : (i += 1) {',
            '        if (i % 15 == 0) {',
            '            try stdout.print("ZiggZagg\\n", .{});',
            '        } else if (i % 5 == 0) {',
            '            try stdout.print("Zagg\\n", .{});',
            '        } else if (i % 3 == 0) {',
            '            try stdout.print("Zigg\\n", .{});',
            '        } else {',
            '            try stdout.print("{}\\n", .{i});',
            '        }',
            '    }',
            '}',
          ].join("\n"),
        },
      ],
    },
    false,
  );

  const editTool = new ToolExecutionComponent(
    "edit",
    {
      file_path: "src/ziggzagg.zig",
      old_string: 'try stdout.print("Zagg\\n", .{});',
      new_string: 'try stdout.print("Zagg!\\n", .{});',
    },
    {},
    undefined,
    tui,
    REPO_ROOT,
  );
  editTool.setArgsComplete();
  editTool.updateResult(
    {
      isError: true,
      content: [
        {
          type: "text",
          text: "Contrast dropped below the hard floor for a rendered panel background.",
        },
      ],
    },
    false,
  );

  const samples: Component[] = [user, assistant, custom, bash, codeTool, editTool];

  for (const sample of samples) {
    sample.render(width);
  }

  return samples;
}

function joinColumns(
  leftLines: string[],
  rightLines: string[],
  leftWidth: number,
  separator: string,
  rightWidth: number,
): string[] {
  const lineCount = Math.max(leftLines.length, rightLines.length);
  const lines: string[] = [];

  for (let index = 0; index < lineCount; index++) {
    const left = padVisible(leftLines[index] ?? "", leftWidth);
    const right = padVisible(rightLines[index] ?? "", rightWidth);
    lines.push(`${left}${separator}${right}`);
  }

  return lines;
}

function padToRows(lines: string[], rowCount: number, filler: string): string[] {
  if (lines.length >= rowCount) {
    return lines.slice(0, rowCount);
  }

  return [...lines, ...Array.from({ length: rowCount - lines.length }, () => filler)];
}

function padVisible(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  return `${truncated}${" ".repeat(padding)}`;
}

function centerText(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return `${" ".repeat(left)}${truncated}${" ".repeat(right)}`;
}

function trimLeadingEmptyLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && visibleWidth(lines[start]?.trim() ?? "") === 0) {
    start += 1;
  }
  return lines.slice(start);
}

function overlayLines(baseLines: string[], overlayLinesInput: string[]): string[] {
  const result = [...baseLines];
  const startRow = Math.max(0, Math.floor((baseLines.length - overlayLinesInput.length) / 2));
  for (let index = 0; index < overlayLinesInput.length; index++) {
    result[startRow + index] = overlayLinesInput[index] ?? result[startRow + index] ?? "";
  }
  return result;
}

function buildHelpOverlay(width: number, height: number): string[] {
  const overlayWidth = Math.min(68, Math.max(44, width - 12));
  const entries = [
    "q, esc, ctrl+c  Quit",
    "?, F1, ctrl+h   Toggle help",
    "f, tab          Cycle dark/light/all",
    "j/k, arrows     Move one theme",
    "pgup/pgdn       Move twenty themes",
    "home/end        Jump to start or end",
    "/               Start search",
    "ctrl+x, ctrl+/  Clear search",
  ];
  const content = [
    centerText("pi theme preview help", overlayWidth),
    "",
    ...entries.map((entry) => padVisible(entry, overlayWidth)),
  ];
  const padTop = Math.max(0, Math.floor((height - content.length) / 2));
  const leftPad = Math.max(0, Math.floor((width - overlayWidth) / 2));
  const bg = "\x1b[48;2;0;0;0m";
  const fg = "\x1b[38;2;255;255;255m";
  const reset = "\x1b[0m";
  return [
    ...Array.from({ length: padTop }, () => ""),
    ...content.map((line) => `${" ".repeat(leftPad)}${bg}${fg}${padVisible(line, overlayWidth)}${reset}`),
  ];
}

function parseMode(value: string | undefined): ThemeMode {
  if (value === "light" || value === "all") {
    return value;
  }
  return "dark";
}

function relativeThemePath(path: string): string {
  return path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path;
}

function bgLine(hex: string, width: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m${" ".repeat(width)}\x1b[49m`;
}

function osc(code: string, value: string): string {
  return `\x1b]${code};${value}\x07`;
}

function enterAlternateScreen(): void {
  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
}

function leaveAlternateScreen(): void {
  process.stdout.write("\x1b[?1049l");
}

function applyTerminalTheme(theme: OriginalTerminalTheme): void {
  process.stdout.write(osc("10", theme.foreground));
  process.stdout.write(osc("11", theme.background));
  process.stdout.write(osc("12", theme.cursor));
  theme.palette.slice(0, 16).forEach((color, index) => {
    process.stdout.write(osc(`4;${index}`, color));
  });
}

function restoreTerminalTheme(): void {
  process.stdout.write("\x1b]104\x07");
  process.stdout.write("\x1b]110\x07");
  process.stdout.write("\x1b]111\x07");
  process.stdout.write("\x1b]112\x07");
}

function cleanupTerminal(): void {
  if (terminalCleanedUp) {
    return;
  }
  terminalCleanedUp = true;
  restoreTerminalTheme();
  leaveAlternateScreen();
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${Math.max(0, Math.min(255, Math.round(r))).toString(16).padStart(2, "0")}${Math.max(0, Math.min(255, Math.round(g))).toString(16).padStart(2, "0")}${Math.max(0, Math.min(255, Math.round(b))).toString(16).padStart(2, "0")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace(/^#/, "");
  const value = normalized.length === 3
    ? normalized
        .split("")
        .map((part) => `${part}${part}`)
        .join("")
    : normalized;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replaceAll("+", "-plus")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseCuratedThemeNames(content: string): string[] {
  const names: string[] = [];
  const regex = /"([^"]+)"/g;
  for (const match of content.matchAll(regex)) {
    const name = match[1];
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function buildCuratedSourceMap(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const sourceName of parseCuratedThemeNames(content)) {
    map.set(`${slugify(sourceName)}-semantic`, sourceName);
  }
  return map;
}

function srgbToLinear(value: number): number {
  return value < 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  return value < 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

function p3ToSrgb(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = 0.4865709486 * rl + 0.2656676932 * gl + 0.1982172852 * bl;
  const y = 0.2289745641 * rl + 0.6917385218 * gl + 0.0792869141 * bl;
  const z = 0.0451133819 * gl + 1.0439443689 * bl;
  const sr = 3.2404541621 * x - 1.537138594 * y - 0.4985314096 * z;
  const sg = -0.9692660305 * x + 1.8760108454 * y + 0.0415560175 * z;
  const sb = 0.0556434309 * x - 0.2040259135 * y + 1.0572251882 * z;
  return [
    Math.max(0, Math.min(1, linearToSrgb(sr))),
    Math.max(0, Math.min(1, linearToSrgb(sg))),
    Math.max(0, Math.min(1, linearToSrgb(sb))),
  ];
}

function plistColorToHex(block: string): string {
  const readComponent = (name: string): number => {
    const match = block.match(new RegExp(`<key>${name}</key>\\s*<real>([^<]+)</real>`));
    return match ? Number.parseFloat(match[1]) : 0;
  };
  const colorSpaceMatch = block.match(/<key>Color Space<\/key>\s*<string>([^<]+)<\/string>/);
  let r = readComponent("Red Component");
  let g = readComponent("Green Component");
  let b = readComponent("Blue Component");
  if (colorSpaceMatch?.[1] === "P3") {
    [r, g, b] = p3ToSrgb(r, g, b);
  }
  return rgbToHex(r * 255, g * 255, b * 255);
}

function extractPlistColor(content: string, key: string, fallback: string): string {
  const pattern = new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<dict>([\\s\\S]*?)<\\/dict>`);
  const match = content.match(pattern);
  return match ? plistColorToHex(match[1]) : fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadOriginalTerminalTheme(sourcePath: string): OriginalTerminalTheme {
  const content = readFileSync(sourcePath, "utf8");
  const palette = Array.from({ length: 16 }, (_, index) =>
    extractPlistColor(content, `Ansi ${index} Color`, index === 0 ? "#000000" : "#ffffff"),
  );
  const foreground = extractPlistColor(content, "Foreground Color", "#ffffff");
  const background = extractPlistColor(content, "Background Color", "#000000");
  const cursor = extractPlistColor(content, "Cursor Color", foreground);
  return { foreground, background, cursor, palette };
}

async function loadThemes(): Promise<ThemeRecord[]> {
  const glob = new Bun.Glob("themes/*-semantic.json");
  const themes: ThemeRecord[] = [];
  const curatedContent = await Bun.file(CURATED_TOML_PATH).text();
  const curatedSourceMap = buildCuratedSourceMap(curatedContent);

  for await (const relativePath of glob.scan({ cwd: REPO_ROOT, absolute: false })) {
    const path = `${REPO_ROOT}/${relativePath}`;
    const data = (await Bun.file(path).json()) as {
      name?: string;
      vars?: { bg?: string; fg?: string; accent?: string };
      export?: { pageBg?: string; cardBg?: string; infoBg?: string };
    };
    const name = data.name ?? relativeThemePath(path).replace(/^themes\//, "").replace(/\.json$/, "");
    const sourceName = curatedSourceMap.get(name) ?? name.replace(/-semantic$/, "");
    const sourcePath = `${UPSTREAM_SCHEMES_DIR}/${sourceName}.itermcolors`;
    const background = data.export?.pageBg ?? data.vars?.bg ?? "#000000";
    const pageBg = data.export?.pageBg ?? data.vars?.bg ?? "#000000";
    themes.push({
      name,
      path,
      sourceName,
      sourcePath,
      background,
      pageBg,
      isDark: relativeLuminance(background) < 0.35,
      originalTerminalTheme: loadOriginalTerminalTheme(sourcePath),
    });
  }

  return themes.sort((first, second) => first.name.localeCompare(second.name));
}

async function main(): Promise<void> {
  process.env[AGENT_DIR_ENV] = REPO_ROOT;
  process.env.COLORTERM = process.env.COLORTERM || "truecolor";

  process.on("exit", cleanupTerminal);
  process.on("SIGINT", () => {
    cleanupTerminal();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanupTerminal();
    process.exit(143);
  });

  const themes = await loadThemes();
  if (themes.length === 0) {
    throw new Error(`No themes found in ${THEMES_DIR}`);
  }

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const browser = new ThemeBrowser(tui, themes, DEFAULT_MODE);

  enterAlternateScreen();
  tui.addChild(browser);
  tui.setFocus(browser);
  tui.start();
}

await main();
