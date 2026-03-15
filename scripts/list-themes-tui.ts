#!/usr/bin/env -S bun --install=force

import "zod/v3";

import {
  Key,
  matchesKey,
  ProcessTerminal,
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
  Theme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@mariozechner/pi-coding-agent";

type ThemeMode = "dark" | "light" | "all";

type ThemeRecord = {
  name: string;
  path: string;
  sourceName: string;
  sourcePath: string;
  background: string;
  pageBg: string;
  isDark: boolean;
  previewTheme: Theme;
};

const SCRIPT_DIR = import.meta.dir;
const REPO_ROOT = `${SCRIPT_DIR}/..`;
const THEMES_DIR = `${REPO_ROOT}/themes`;
const UPSTREAM_SCHEMES_DIR = `${REPO_ROOT}/.upstream/iTerm2-Color-Schemes/schemes`;
const CURATED_TOML_PATH = `${REPO_ROOT}/curated.toml`;
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const DEFAULT_MODE: ThemeMode = parseMode(Bun.argv[2]);
const THEME_LIST_JUMP_SIZE = 20;
let terminalCleanedUp = false;

class ThemeBrowser implements Component {
  private readonly tui: TUI;
  private readonly allThemes: ThemeRecord[];
  private previewComponents: Component[] = [];
  private readonly previewLinesCache = new Map<string, string[]>();
  private filteredThemes: ThemeRecord[] = [];
  private mode: ThemeMode;
  private helpMode = false;
  private searchMode = false;
  private searchQuery = "";
  private listVisibleRows = 18;
  private listScrollOffset = 0;
  private hoveredListIndex?: number;
  private selectedIndex = 0;
  private selectedTheme?: ThemeRecord;
  private previewWidth = 72;
  private lastLeftPaneWidth = 24;

  constructor(tui: TUI, themes: ThemeRecord[], mode: ThemeMode) {
    this.tui = tui;
    this.allThemes = themes;
    this.mode = mode;
    this.resetItems();
  }

  invalidate(): void {
    for (const component of this.previewComponents) {
      component.invalidate?.();
    }
  }

  handleInput(data: string): void {
    const mouseEvent = parseMouseEvent(data);
    if (mouseEvent) {
      this.handleMouseInput(mouseEvent);
      return;
    }

    if (this.helpMode) {
      this.handleHelpInput(data);
      return;
    }

    if (this.searchMode) {
      this.handleSearchInput(data);
      return;
    }

    if (this.shouldQuit(data)) {
      this.stop();
      return;
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
      this.selectThemeByIndex(0);
      return;
    }

    if (matchesKey(data, "end")) {
      this.selectThemeByIndex(Math.max(0, this.filteredThemes.length - 1));
      return;
    }

    if (matchesKey(data, "page_down")) {
      this.moveSelection(THEME_LIST_JUMP_SIZE);
      return;
    }

    if (matchesKey(data, "page_up")) {
      this.moveSelection(-THEME_LIST_JUMP_SIZE);
      return;
    }

    if (matchesKey(data, Key.down) || data === "j" || data === "+") {
      this.moveSelection(1);
      return;
    }

    if (matchesKey(data, Key.up) || data === "k" || data === "-") {
      this.moveSelection(-1);
      return;
    }
  }

  render(width: number): string[] {
    const separator = " │ ";
    const totalRows = Math.max(8, this.tui.terminal.rows);
    const bodyRows = Math.max(6, totalRows - 1);
    const leftWidth = Math.max(24, Math.min(32, Math.floor(width * 0.26)));
    const rightWidth = Math.max(36, width - leftWidth - visibleWidth(separator));
    this.previewWidth = rightWidth;
    this.lastLeftPaneWidth = leftWidth;
    this.listVisibleRows = bodyRows;
    this.ensureSelectionVisible();

    const leftLines = this.renderThemeList(leftWidth, bodyRows);
    const rightLines = padToRows(this.renderPreview(rightWidth), bodyRows, this.getPreviewFiller(rightWidth));
    const separatorBg = this.selectedTheme?.pageBg ?? this.filteredThemes[0]?.pageBg ?? "#000000";
    let body = joinColumns(leftLines, rightLines, leftWidth, separator, rightWidth, separatorBg);
    if (this.helpMode) {
      body = overlayLines(body, buildHelpOverlay(width, bodyRows, this.getChromeTheme()));
    }
    if (this.searchMode) {
      body = overlayLines(body, buildSearchOverlay(width, bodyRows, this.searchQuery, this.getChromeTheme()));
    }

    return [...body, this.renderFooter(width)];
  }

  private handleMouseInput(event: MouseEvent): void {
    if (this.helpMode || this.searchMode) {
      return;
    }

    if (event.col > this.lastLeftPaneWidth) {
      return;
    }

    if (event.kind === "wheel-up") {
      this.moveSelection(-1);
      return;
    }

    if (event.kind === "wheel-down") {
      this.moveSelection(1);
      return;
    }

    const rowIndex = event.row - 1;
    if (rowIndex < 0 || rowIndex >= this.listVisibleRows) {
      return;
    }

    const index = this.listScrollOffset + rowIndex;
    if (index >= this.filteredThemes.length) {
      return;
    }

    this.hoveredListIndex = index;
    if (event.kind === "left-release") {
      this.selectThemeByIndex(index);
      return;
    }

    this.tui.requestRender();
  }

  private handleHelpInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "?" || matchesKey(data, Key.f1) || matchesKey(data, Key.ctrl("h"))) {
      this.helpMode = false;
      this.tui.requestRender();
      return;
    }

    if (this.shouldQuit(data)) {
      this.stop();
    }
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

  private shouldQuit(data: string): boolean {
    return matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.escape) || data === "q" || data === "Q";
  }

  private stop(): void {
    this.tui.stop();
    cleanupTerminal();
    process.exit(0);
  }

  private renderPreview(width: number): string[] {
    if (!this.selectedTheme) {
      return [padLineBackground(padVisible(centerText("No theme selected", width), width), width, "#000000")];
    }

    const cacheKey = `${this.selectedTheme.name}:${width}`;
    const cached = this.previewLinesCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const lines: string[] = [
      centerText(this.selectedTheme.name, width),
      centerText(relativeThemePath(this.selectedTheme.sourcePath), width),
      centerText(`mode:${this.mode}  themes:${this.filteredThemes.length}`, width),
    ];
    const sectionBorder = new DynamicBorder();

    for (let index = 0; index < this.previewComponents.length; index++) {
      if (index > 0) {
        lines.push(...sectionBorder.render(width));
      }
      const rendered = this.previewComponents[index].render(width);
      lines.push(...(index === 0 ? trimLeadingEmptyLines(rendered) : rendered));
    }

    const normalized = lines.map((line) => padLineBackground(truncateToWidth(line, width), width, this.selectedTheme.pageBg));
    this.previewLinesCache.set(cacheKey, normalized);
    return normalized;
  }

  private renderThemeList(width: number, rows: number): string[] {
    const theme = this.getChromeTheme();
    const pageBg = this.selectedTheme?.pageBg ?? this.filteredThemes[0]?.pageBg ?? "#000000";
    const visibleThemes = this.filteredThemes.slice(this.listScrollOffset, this.listScrollOffset + rows);
    const lines = visibleThemes.map((entry, rowIndex) => {
      const index = this.listScrollOffset + rowIndex;
      const isSelected = index === this.selectedIndex;
      const isHovered = index === this.hoveredListIndex;
      return renderThemeListRow(entry.name, width, theme, pageBg, isSelected, isHovered);
    });

    return padToRows(lines, rows, padLineBackground("", width, pageBg));
  }

  private renderFooter(width: number): string {
    const search = this.searchQuery ? `query:${this.searchQuery}` : `filter:${this.mode}`;
    const help = this.searchMode
      ? "type to filter  enter close  ctrl+x clear"
      : this.helpMode
        ? "esc close"
        : "j/k move  pgup/pgdn jump  / search  f filter  ? help  q quit";
    const pageBg = this.selectedTheme?.pageBg ?? this.filteredThemes[0]?.pageBg ?? "#000000";
    const chromeTheme = this.getChromeTheme();
    const footerText = chromeTheme.fg("muted", truncateToWidth(`${search}  ${help}`, width));
    return padLineBackground(footerText, width, pageBg);
  }

  private moveSelection(delta: number): void {
    this.hoveredListIndex = undefined;
    this.selectThemeByIndex(clamp(this.selectedIndex + delta, 0, Math.max(0, this.filteredThemes.length - 1)));
  }

  private selectThemeByIndex(index: number): void {
    if (this.filteredThemes.length === 0) {
      return;
    }

    this.selectedIndex = clamp(index, 0, this.filteredThemes.length - 1);
    this.ensureSelectionVisible();
    const theme = this.filteredThemes[this.selectedIndex];
    if (theme) {
      this.activateTheme(theme);
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

  private ensureSelectionVisible(): void {
    if (this.filteredThemes.length === 0) {
      this.listScrollOffset = 0;
      return;
    }

    const maxOffset = Math.max(0, this.filteredThemes.length - this.listVisibleRows);
    if (this.selectedIndex < this.listScrollOffset) {
      this.listScrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.listScrollOffset + this.listVisibleRows) {
      this.listScrollOffset = this.selectedIndex - this.listVisibleRows + 1;
    }
    this.listScrollOffset = clamp(this.listScrollOffset, 0, maxOffset);
  }

  private resetItems(): void {
    const currentName = this.selectedTheme?.name;
    this.filteredThemes = this.getThemesForMode();
    this.hoveredListIndex = undefined;

    if (this.filteredThemes.length === 0) {
      this.selectedTheme = undefined;
      this.selectedIndex = 0;
      this.listScrollOffset = 0;
      return;
    }

    const nextIndex = currentName
      ? this.filteredThemes.findIndex((theme) => theme.name === currentName)
      : 0;
    this.selectedIndex = nextIndex >= 0 ? nextIndex : 0;
    this.ensureSelectionVisible();
    const nextTheme = this.filteredThemes[this.selectedIndex];
    if (nextTheme) {
      this.activateTheme(nextTheme);
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

  private activateTheme(theme: ThemeRecord): void {
    if (this.selectedTheme?.name === theme.name) {
      return;
    }

    process.env[AGENT_DIR_ENV] = REPO_ROOT;
    process.env.COLORTERM = process.env.COLORTERM || "truecolor";
    setPreviewThemeInstance(theme.previewTheme);

    this.selectedTheme = theme;
    if (this.previewComponents.length === 0) {
      this.previewComponents = buildPreviewComponents(this.tui, this.previewWidth);
    }
    this.invalidate();
    this.tui.requestRender();
  }

  private getChromeTheme(): Theme {
    return this.selectedTheme?.previewTheme ?? this.filteredThemes[0]?.previewTheme ?? this.allThemes[0]!.previewTheme;
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
  bash.appendOutput("Generated 65 themes\n");
  bash.appendOutput("WARN later-this-evening: muted on bg contrast 39 (<42)\n");
  bash.appendOutput("All 65 themes pass (with warnings)\n");
  bash.setComplete(0, false);

  const codeTool = new ToolExecutionComponent(
    "read",
    { path: "src/theme-preview.ts", offset: 1, limit: 18 },
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
            'type ThemeMode = "dark" | "light" | "all";',
            "",
            "export function formatPreviewTitle(name: string, mode: ThemeMode): string {",
            "  return `${name} · ${mode}`;",
            "}",
            "",
            "export function weakestPairs(values: Array<{ label: string; contrast: number }>) {",
            "  return values",
            "    .filter((pair) => pair.contrast < 42)",
            "    .sort((left, right) => left.contrast - right.contrast)",
            "    .slice(0, 3);",
            "}",
          ].join("\n"),
        },
      ],
    },
    false,
  );

  const editTool = new ToolExecutionComponent(
    "edit",
    {
      file_path: "src/theme-preview.ts",
      old_string: '    .slice(0, 3);',
      new_string: '    .slice(0, 5);',
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
  separatorBg: string,
): string[] {
  const lineCount = Math.max(leftLines.length, rightLines.length);
  const lines: string[] = [];
  const styledSeparator = paintBackground(separator, separatorBg);

  for (let index = 0; index < lineCount; index++) {
    const left = padVisible(leftLines[index] ?? "", leftWidth);
    const right = padVisible(rightLines[index] ?? "", rightWidth);
    lines.push(`${left}${styledSeparator}${right}`);
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

function renderThemeListRow(name: string, width: number, theme: Theme, pageBg: string, isSelected: boolean, isHovered: boolean): string {
  const innerWidth = Math.max(0, width - 4);
  const label = truncateToWidth(name, innerWidth);
  if (isSelected) {
    const left = "❯ ";
    const right = " ❮";
    const padding = Math.max(0, width - visibleWidth(left) - visibleWidth(label) - visibleWidth(right));
    return `${theme.getBgAnsi("selectedBg")}${theme.getFgAnsi("accent")}${left}${label}${" ".repeat(padding)}${right}\x1b[39m\x1b[49m`;
  }

  const prefix = isHovered ? "• " : "  ";
  const text = isHovered ? theme.fg("accent", `${prefix}${label}`) : theme.fg("muted", `${prefix}${label}`);
  return padLineBackground(text, width, pageBg);
}

function buildBoxOverlay(title: string, body: string[], width: number, maxWidth: number, theme: Theme): string[] {
  const overlayWidth = Math.min(maxWidth, Math.max(44, width - 12));
  const innerWidth = overlayWidth - 4;
  const borderColor = theme.getFgAnsi("borderMuted");
  const titleColor = theme.getFgAnsi("accent");
  const textColor = theme.getFgAnsi("text");
  const bg = theme.getBgAnsi("userMessageBg");
  const reset = "\x1b[39m\x1b[49m";
  const horizontal = "─".repeat(Math.max(0, overlayWidth - 2));
  const lines = [`${borderColor}┌${horizontal}┐${reset}`];
  lines.push(`${borderColor}│${bg} ${titleColor}${padVisible(title, innerWidth)}${reset}${borderColor} │${reset}`);
  lines.push(`${borderColor}├${horizontal}┤${reset}`);
  for (const line of body) {
    lines.push(`${borderColor}│${bg} ${textColor}${padVisible(line, innerWidth)}${reset}${borderColor} │${reset}`);
  }
  lines.push(`${borderColor}└${horizontal}┘${reset}`);
  return lines;
}

function buildHelpOverlay(width: number, _height: number, theme: Theme): string[] {
  return buildBoxOverlay(
    "Preview help",
    [
      "j/k, arrows     move selection",
      "pgup/pgdn       jump by twenty",
      "home/end        jump to first or last",
      "mouse wheel      scroll themes",
      "left click       select theme",
      "f, tab          cycle dark/light/all",
      "/               open search",
      "ctrl+x          clear search",
      "q, esc          quit or close overlay",
    ],
    width,
    72,
    theme,
  );
}

function buildSearchOverlay(width: number, _height: number, query: string, theme: Theme): string[] {
  return buildBoxOverlay(
    "Search themes",
    [
      query.length > 0 ? query : "Type to filter themes by name",
      "Enter or Esc closes search",
      "Ctrl+X clears the query",
    ],
    width,
    64,
    theme,
  );
}

type MouseEvent = {
  kind: "wheel-up" | "wheel-down" | "left-press" | "left-release";
  col: number;
  row: number;
};

function parseMouseEvent(data: string): MouseEvent | null {
  const match = data.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
  if (!match) {
    return null;
  }

  const button = Number.parseInt(match[1], 10);
  const col = Number.parseInt(match[2], 10);
  const row = Number.parseInt(match[3], 10);
  const suffix = match[4];

  if ((button & 64) !== 0) {
    return {
      kind: (button & 1) === 0 ? "wheel-up" : "wheel-down",
      col,
      row,
    };
  }

  if ((button & 3) === 0) {
    return {
      kind: suffix === "m" ? "left-release" : "left-press",
      col,
      row,
    };
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function paintBackground(text: string, hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const bgAnsi = `\x1b[48;2;${r};${g};${b}m`;
  const normalized = text
    .replaceAll("\x1b[49m", bgAnsi)
    .replaceAll("\x1b[0m", `\x1b[39m${bgAnsi}`);
  return `${bgAnsi}${normalized}\x1b[49m`;
}

function padLineBackground(line: string, width: number, hex: string): string {
  const padded = padVisible(line, width);
  return paintBackground(padded, hex);
}

function enterAlternateScreen(): void {
  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
}

function leaveAlternateScreen(): void {
  process.stdout.write("\x1b[?1049l");
}

function enableMouseMode(): void {
  process.stdout.write("\x1b[?1000h\x1b[?1006h");
}

function disableMouseMode(): void {
  process.stdout.write("\x1b[?1000l\x1b[?1006l");
}

function cleanupTerminal(): void {
  if (terminalCleanedUp) {
    return;
  }
  terminalCleanedUp = true;
  disableMouseMode();
  leaveAlternateScreen();
}

function setPreviewThemeInstance(theme: Theme): void {
  const themeKey = Symbol.for("@mariozechner/pi-coding-agent:theme");
  Reflect.set(globalThis, themeKey, theme);
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
    map.set(slugify(sourceName), sourceName);
  }
  return map;
}

type ThemeJson = {
  name?: string;
  vars?: Record<string, string>;
  colors?: Record<string, string>;
  export?: { pageBg?: string };
};

function resolvePreviewColorValue(
  value: string,
  varsMap: Record<string, string>,
  inheritedFallback: string,
  visited = new Set<string>(),
): string {
  if (value === "") {
    return inheritedFallback;
  }
  if (value.startsWith("#")) {
    return value;
  }

  const nextValue = varsMap[value];
  if (!nextValue) {
    return value;
  }

  if (visited.has(value)) {
    throw new Error(`Circular theme variable reference detected: ${value}`);
  }

  visited.add(value);
  return resolvePreviewColorValue(nextValue, varsMap, inheritedFallback, visited);
}

function createPreviewThemeFromJson(path: string, data: ThemeJson): Theme {
  const varsMap = data.vars ?? {};
  const colorsMap = data.colors ?? {};
  const bgColorKeys = new Set([
    "selectedBg",
    "userMessageBg",
    "customMessageBg",
    "toolPendingBg",
    "toolSuccessBg",
    "toolErrorBg",
  ]);
  const fgColors: Record<string, string> = {};
  const bgColors: Record<string, string> = {};

  for (const [key, value] of Object.entries(colorsMap)) {
    const inheritedFallback = bgColorKeys.has(key) ? (varsMap.bg ?? "#000000") : (varsMap.fg ?? "#ffffff");
    const resolved = resolvePreviewColorValue(value, varsMap, inheritedFallback);
    if (bgColorKeys.has(key)) {
      bgColors[key] = resolved;
      continue;
    }
    fgColors[key] = resolved;
  }

  return new Theme(fgColors, bgColors, "truecolor", {
    name: data.name,
    sourcePath: path,
  });
}

async function loadThemes(): Promise<ThemeRecord[]> {
  const glob = new Bun.Glob("themes/*.json");
  const themes: ThemeRecord[] = [];
  const curatedContent = await Bun.file(CURATED_TOML_PATH).text();
  const curatedSourceMap = buildCuratedSourceMap(curatedContent);

  for await (const relativePath of glob.scan({ cwd: REPO_ROOT, absolute: false })) {
    const path = `${REPO_ROOT}/${relativePath}`;
    const data = (await Bun.file(path).json()) as ThemeJson;
    const name = data.name ?? relativeThemePath(path).replace(/^themes\//, "").replace(/\.json$/, "");
    const sourceName = curatedSourceMap.get(name) ?? name;
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
      previewTheme: createPreviewThemeFromJson(path, data),
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
  enableMouseMode();
  tui.addChild(browser);
  tui.setFocus(browser);
  tui.start();
}

await main();
