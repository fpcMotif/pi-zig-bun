import process from "node:process";

// ---------------------------------------------------------------------------
// ANSI escape helpers -- zero dependencies, explicit codes only.
// ---------------------------------------------------------------------------

const ESC = "\x1b[";

/** ANSI SGR (Select Graphic Rendition) sequences. */
const ansi = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,

  // Foreground colors
  fg: {
    red: `${ESC}31m`,
    green: `${ESC}32m`,
    yellow: `${ESC}33m`,
    blue: `${ESC}34m`,
    magenta: `${ESC}35m`,
    cyan: `${ESC}36m`,
    white: `${ESC}37m`,
    gray: `${ESC}90m`,
  },

  // Cursor / line control
  clearLine: `${ESC}2K`,
  cursorToCol0: `\r`,
  hideCursor: `${ESC}?25l`,
  showCursor: `${ESC}?25h`,
} as const;

/** Wrap `text` in an ANSI color/style, resetting afterwards. */
function styled(text: string, ...codes: string[]): string {
  return `${codes.join("")}${text}${ansi.reset}`;
}

// ---------------------------------------------------------------------------
// Spinner -- cycles through Unicode braille characters.
// ---------------------------------------------------------------------------

/**
 * Braille-dot spinner frames.  Each frame is a single character so terminal
 * width consumed by the spinner is always exactly 1 column.
 */
const SPINNER_FRAMES: readonly string[] = [
  "\u2800", // ⠀
  "\u2801", // ⠁
  "\u2803", // ⠃
  "\u2807", // ⠇
  "\u280F", // ⠏
  "\u281F", // ⠟
  "\u283F", // ⠿
  "\u281F", // ⠟
  "\u280F", // ⠏
  "\u2807", // ⠇
  "\u2803", // ⠃
  "\u2801", // ⠁
] as const;

const SPINNER_INTERVAL_MS = 80;

// ---------------------------------------------------------------------------
// TuiRenderer
// ---------------------------------------------------------------------------

/**
 * Handles all terminal output for the interactive chat loop.
 *
 * Design goals:
 *  - No external dependencies.
 *  - Explicit ANSI codes, no "magic" colour libraries.
 *  - Spinner runs on a simple setInterval; cleaned up deterministically.
 *  - Every public method is synchronous (writes are buffered by the OS).
 */
export class TuiRenderer {
  private readonly out: NodeJS.WriteStream;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private spinnerActive = false;

  constructor(out: NodeJS.WriteStream = process.stdout) {
    this.out = out;
  }

  // -----------------------------------------------------------------------
  // Low-level write helpers
  // -----------------------------------------------------------------------

  /** Write raw string to the output stream. */
  private write(data: string): void {
    this.out.write(data);
  }

  /** Clear the current terminal line and move cursor to column 0. */
  clear(): void {
    this.write(`${ansi.cursorToCol0}${ansi.clearLine}`);
  }

  // -----------------------------------------------------------------------
  // Spinner (thinking indicator)
  // -----------------------------------------------------------------------

  /** Show a cycling braille spinner with a "thinking..." label. */
  startThinking(): void {
    if (this.spinnerActive) return;
    this.spinnerActive = true;
    this.spinnerFrame = 0;

    this.write(ansi.hideCursor);
    this.renderSpinnerFrame();

    this.spinnerTimer = setInterval(() => {
      this.renderSpinnerFrame();
    }, SPINNER_INTERVAL_MS);
  }

  /** Stop the spinner and clean up the line it occupied. */
  stopThinking(): void {
    if (!this.spinnerActive) return;
    this.spinnerActive = false;

    if (this.spinnerTimer !== null) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }

    this.clear();
    this.write(ansi.showCursor);
  }

  private renderSpinnerFrame(): void {
    const frame = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length];
    const label = styled(
      `${frame} thinking...`,
      ansi.dim,
      ansi.fg.cyan,
    );
    this.clear();
    this.write(label);
    this.spinnerFrame++;
  }

  // -----------------------------------------------------------------------
  // Streaming output
  // -----------------------------------------------------------------------

  /** Write the "assistant> " prefix at the start of a response. */
  writeAssistantPrefix(): void {
    this.write(styled("assistant> ", ansi.bold, ansi.fg.blue));
  }

  /** Append a single token during streaming. */
  writeToken(token: string): void {
    this.write(token);
  }

  /** Display a formatted tool-call block. */
  writeToolCall(name: string, args: string): void {
    const header = styled(`\n[tool_call ${name}]`, ansi.bold, ansi.fg.yellow);
    const body = styled(` ${args}`, ansi.dim, ansi.fg.yellow);
    this.write(`${header}${body}`);
  }

  /** Show that a tool is being executed. */
  writeToolExecution(toolName: string): void {
    this.write(styled(`\n  executing ${toolName}...`, ansi.dim, ansi.fg.cyan));
  }

  /** Mark tool execution as complete. */
  writeToolExecutionDone(): void {
    this.write(styled(" done", ansi.fg.green));
  }

  /** Display a warning when the tool loop hits its ceiling. */
  writeToolLoopCeiling(maxRounds: number): void {
    this.write(styled(`\n[agent] tool-call loop hit ceiling (${maxRounds} rounds)\n`, ansi.bold, ansi.fg.yellow));
  }

  /** Display an error message in red. */
  writeError(msg: string): void {
    this.write(styled(`\n[error] ${msg}\n`, ansi.bold, ansi.fg.red));
  }

  // -----------------------------------------------------------------------
  // Prompt & banner
  // -----------------------------------------------------------------------

  /** Print the startup banner. */
  writeBanner(): void {
    this.write(
      styled("pi-zig-bun interactive\n", ansi.bold, ansi.fg.magenta),
    );
    this.write(
      styled("Type /help for commands.\n", ansi.dim, ansi.fg.gray),
    );
  }

  /**
   * Return the styled prompt string.
   *
   * Note: readline needs the *unformatted* prompt length to calculate cursor
   * position correctly.  The ANSI codes are zero-width but readline counts
   * bytes.  We wrap the invisible sequences in \x01 / \x02 (readline escape
   * brackets) so the cursor math stays correct.
   */
  promptString(): string {
    // \x01 and \x02 tell readline to ignore enclosed bytes for width calc.
    return `\x01${ansi.bold}${ansi.fg.green}\x02pi> \x01${ansi.reset}\x02`;
  }

  /** Write a newline after the assistant response finishes. */
  writeNewline(): void {
    this.write("\n");
  }
}
