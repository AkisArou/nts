// `readline.Interface`, from node v24.20.0 `lib/internal/readline/interface.js`.
//
// A line editor. Two quite different programs live in this class and the
// `terminal` flag chooses between them.
//
// Without a terminal it is a line splitter: bytes arrive, they are decoded,
// and every line ending produces a `line` event. That is the mode a program
// gets when its input is a pipe or a file, and it is almost all of the code
// anyone runs in production.
//
// With a terminal it is an editor. The terminal is in raw mode, so nothing
// arrives pre-assembled -- every keystroke is delivered as it happens and this
// class owns the cursor, the visible line, the history, the kill ring and the
// undo stack. Everything the user believes their terminal is doing, from the
// left arrow key to Ctrl+W, happens here.
//
// The reason it is one class rather than two is that a program cannot know
// which it will get: `readline.createInterface({ input: process.stdin })` is
// the same call whether stdin is a terminal or a pipe, and the `line` events
// have to mean the same thing either way.

import { EventEmitter, kFirstEventParam, on as onEvent } from "../../events/src/main.ts";
import { StringDecoder } from "../../string_decoder/src/main.ts";
import type { Buffer } from "../../buffer/src/main.ts";
import { inspect } from "../../util/src/inspect.ts";
import { getStringWidth } from "../../util/src/width.ts";
import { stripVTControlCharacters } from "../../util/src/main.ts";
import {
  clearScreenDown,
  cursorTo,
  moveCursor,
} from "../../internal/readline-callbacks.ts";
import {
  ERR_INVALID_ARG_VALUE,
  ERR_USE_AFTER_CLOSE,
  AbortError,
} from "../../internal/errors.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";
import {
  validateAbortSignal,
  validateString,
  validateUint32,
} from "../../internal/validators.ts";
import { nextTick } from "../../internal/tick.ts";
import { History, type HistoryOptions } from "./history.ts";
import { emitKeypressEvents, kSawKeyPress } from "./keypress.ts";
import { charLengthAt, charLengthLeft, commonPrefix, type Key } from "./utils.ts";

declare function nts_process_env(name: string): string;

/**
 * The shortest gap that can separate a `\r` from its `\n`.
 *
 * A terminal sends CRLF as two events and a program must not see two lines.
 * Node's floor is 100ms, which is long enough that no real pair is split and
 * short enough that a genuine empty line typed a moment later still counts.
 */
const MIN_CRLF_DELAY = 100;
const ESCAPE_CODE_TIMEOUT = 500;
const MAX_KILL_RING = 32;
const MAX_UNDO_REDO_STACK = 2048;

/** What continuation lines of a multiline entry are prefixed with. */
const MULTILINE_PROMPT = "| ";

/** Internal operations shared by the callback and promise public classes. */
const kQuestion = Symbol("question");
const kQuestionCancel = Symbol("questionCancel");

/** Typed implementation behind the Node-only `util.promisify.custom` hook. */
export const kQuestionPromise = Symbol("questionPromise");

/**
 * `\r\n`, `\r`, `\n`, and the two Unicode line separators.
 *
 * U+2028 and U+2029 written as escapes and not as themselves, because U+2028
 * is a line terminator in JavaScript source: written literally it ends the
 * line it is on, and a regular expression literal cannot span lines. The
 * failure is `Invalid regular expression: missing /`, pointing at a line that
 * looks correct.
 */
const LINE_ENDING = /\r?\n|\r(?!\n)|\u2028|\u2029/g;

export interface Completion {
  0: string[];
  1: string;
}

export type CompletionCallback = (err: unknown, result?: Completion) => void;

/**
 * Both public completer spellings share one safe invocation signature.
 *
 * A synchronous or promise completer simply ignores the second argument and
 * returns its result. A callback completer uses it and returns `void`.
 * TypeScript permits a one-argument function where this two-argument function
 * is expected, so no observable `Function.length` metadata is needed to tell
 * the two apart at run time.
 */
export type Completer = (
  line: string,
  callback: CompletionCallback,
) => Completion | Promise<Completion> | void;

export interface InputStream {
  isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
  on<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  removeListener<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  listenerCount(event: string): number;
  emit(event: string, ...args: unknown[]): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface OutputStream {
  write(chunk: string, callback?: (err?: Error | null) => void): boolean;
  columns?: number;
  rows?: number;
  isTTY?: boolean;
  on<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  removeListener<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
}

export interface InterfaceOptions {
  input: InputStream;
  output?: OutputStream | null | undefined;
  completer?: Completer | undefined;
  terminal?: boolean | undefined;
  history?: string[] | undefined;
  historySize?: number | undefined;
  removeHistoryDuplicates?: boolean | undefined;
  prompt?: string | undefined;
  crlfDelay?: number | undefined;
  escapeCodeTimeout?: number | undefined;
  tabSize?: number | undefined;
  signal?: AbortSignalLike | undefined;
}

function isInterfaceOptions(value: InterfaceOptions | InputStream): value is InterfaceOptions {
  return "input" in value;
}

export interface QuestionOptions {
  signal?: AbortSignalLike | undefined;
}

type QuestionCallback = (answer: string) => void;

function isQuestionCallback(value: unknown): value is QuestionCallback {
  return typeof value === "function";
}

interface CursorPos {
  rows: number;
  cols: number;
}

interface UndoEntry {
  text: string;
  cursor: number;
}

/**
 * The common line editor, without either public `question` call shape.
 *
 * Node likewise keeps the editor in an internal base and adds callback and
 * promise methods in two separate public classes. Keeping that split here
 * means neither class has to claim overloads or behavior belonging to the
 * other one.
 */
export class InterfaceBase extends EventEmitter {
  line = "";
  cursor = 0;
  terminal: boolean;
  input: InputStream;
  output: OutputStream | null | undefined;
  completer: Completer | undefined;
  closed = false;
  paused = false;
  prevRows = 0;
  tabSize = 8;
  escapeCodeTimeout = ESCAPE_CODE_TIMEOUT;
  crlfDelay: number;

  /**
   * Whether a completion attempt should be made for the current keystroke.
   *
   * Set by the keypress decoder, not here: it is true only for the final
   * character of a chunk, so that pasting a word does not run the completer
   * once per letter.
   */
  isCompletionEnabled = true;

  /** Promise readline deliberately observes even immediate answers next turn. */
  protected deferCompletions = false;

  /** Set by the keypress decoder when the chunk was a single character. */
  declare [kSawKeyPress]: boolean;

  #historyManager: History;
  #prompt = "> ";
  #oldPrompt = "";
  #questionCallback: QuestionCallback | null = null;
  #questionReject: ((reason: unknown) => void) | null = null;
  #decoder: StringDecoder | undefined;
  #lineBuffer = "";
  #sawReturnAt = 0;
  #isMultiline = false;
  #substringSearch: string | null = null;
  #previousKey: Key | null = null;
  #lastCommandErrored = false;

  #undoStack: UndoEntry[] = [];
  #redoStack: UndoEntry[] = [];

  /**
   * Previously deleted text, newest first.
   *
   * Emacs calls this the kill ring, and the point of it being a ring rather
   * than a single slot is `yank pop`: after pasting, meta+y replaces what was
   * pasted with the next-oldest deletion, so several deletions ago is still
   * reachable without having kept it anywhere.
   */
  #killRing: string[] = [];
  #killRingCursor = 0;
  #yanking = false;

  #previousCursorCols = -1;

  #lineObjectStream: AsyncIterableIterator<string> | undefined;

  constructor(options: InterfaceOptions);
  constructor(
    input: InputStream,
    output?: OutputStream | null,
    completer?: Completer,
    terminal?: boolean,
  );
  constructor(
    options: InterfaceOptions | InputStream,
    positionalOutput?: OutputStream | null,
    positionalCompleter?: Completer,
    positionalTerminal?: boolean,
  ) {
    super();

    let input: InputStream;
    let output: OutputStream | null | undefined;
    let completer: Completer | undefined;
    let terminal: boolean | undefined;
    let signal: AbortSignalLike | undefined;
    let crlfDelay: number | undefined;
    let prompt = "> ";
    let historyOptions: HistoryOptions = {};

    if (isInterfaceOptions(options)) {
      const o = options;
      input = o.input;
      output = o.output;
      completer = o.completer;
      terminal = o.terminal;
      signal = o.signal;
      crlfDelay = o.crlfDelay;
      historyOptions = {
        size: o.historySize,
        history: o.history,
        removeHistoryDuplicates: o.removeHistoryDuplicates,
      };
      if (o.tabSize !== undefined) {
        validateUint32(o.tabSize, "tabSize", true);
        this.tabSize = o.tabSize;
      }
      if (o.prompt !== undefined) prompt = o.prompt;
      if (o.escapeCodeTimeout !== undefined) {
        if (Number.isFinite(o.escapeCodeTimeout)) {
          this.escapeCodeTimeout = o.escapeCodeTimeout;
        } else {
          throw new ERR_INVALID_ARG_VALUE("input.escapeCodeTimeout", o.escapeCodeTimeout);
        }
      }
      if (signal) validateAbortSignal(signal, "options.signal");
    } else {
      // The positional form, `createInterface(input, output, completer,
      // terminal)`, which predates the options object and is still used.
      input = options;
      output = positionalOutput;
      completer = positionalCompleter;
      terminal = positionalTerminal;
    }

    if (completer !== undefined && typeof completer !== "function") {
      throw new ERR_INVALID_ARG_VALUE("completer", completer);
    }

    // Whether this is a terminal is the output's business, not the input's:
    // the editor draws, and a program piping its output to a file wants the
    // lines and not the escape sequences.
    if (terminal === undefined && output !== null && output !== undefined) {
      terminal = !!output.isTTY;
    }

    this.input = input;
    this.output = output;
    this.completer = completer;
    this.crlfDelay = crlfDelay ? Math.max(MIN_CRLF_DELAY, crlfDelay) : MIN_CRLF_DELAY;
    this.#historyManager = new History(this, historyOptions);
    this.setPrompt(prompt);
    this.terminal = !!terminal;

    const onError = (err: unknown): void => { this.emit("error", err); };
    const onData = (data: Buffer | string): void => { this.#normalWrite(data); };

    // Two different ends, because the two modes hold their unfinished line in
    // different places: the splitter in a buffer, the editor on screen.
    const onEnd = (): void => {
      if (this.#lineBuffer.length > 0) this.emit("line", this.#lineBuffer);
      this.close();
    };
    const onTermEnd = (): void => {
      if (this.line.length > 0) this.emit("line", this.line);
      this.close();
    };

    const onKeypress = (s: string | undefined, key: Key | undefined): void => {
      this.#ttyWrite(s, key);
      if (key?.sequence) {
        // Half of a surrogate pair on its own draws as nothing until its other
        // half arrives, so the line is redrawn rather than appended to.
        const ch = key.sequence.codePointAt(0) ?? 0;
        if (ch >= 0xd800 && ch <= 0xdfff) this.#refreshLine();
      }
    };

    const onResize = (): void => { this.#refreshLine(); };

    input.on("error", onError);

    if (!this.terminal) {
      input.on("data", onData);
      input.on("end", onEnd);
      this.once("close", () => {
        input.removeListener("data", onData);
        input.removeListener("error", onError);
        input.removeListener("end", onEnd);
      });
      this.#decoder = new StringDecoder("utf8");
    } else {
      emitKeypressEvents(input, this);
      input.on("keypress", onKeypress);
      input.on("end", onTermEnd);
      this.#setRawMode(true);
      this.cursor = 0;
      if (output !== null && output !== undefined) output.on("resize", onResize);
      this.once("close", () => {
        input.removeListener("keypress", onKeypress);
        input.removeListener("error", onError);
        input.removeListener("end", onTermEnd);
        if (output !== null && output !== undefined) {
          output.removeListener("resize", onResize);
        }
      });
    }

    if (signal) {
      const onAborted = (): void => { this.close(); };
      if (signal.aborted) {
        nextTick(onAborted);
      } else {
        signal.addEventListener("abort", onAborted, { once: true });
        this.once("close", () => signal.removeEventListener("abort", onAborted));
      }
    }

    this.#setLine("");
    input.resume();
  }

  get history(): string[] { return this.#historyManager.history; }
  set history(value: string[]) { this.#historyManager.history = value; }
  get historyIndex(): number { return this.#historyManager.index; }
  set historyIndex(value: number) { this.#historyManager.index = value; }
  get historySize(): number { return this.#historyManager.size; }

  /** How wide the terminal is, or unbounded when there is no terminal. */
  get columns(): number {
    if (this.output && this.output.columns) return this.output.columns;
    return Infinity;
  }

  setPrompt(prompt: string): void {
    this.#prompt = prompt;
  }

  getPrompt(): string {
    return this.#prompt;
  }

  #setRawMode(mode: boolean): boolean {
    const wasRaw = !!this.input.isRaw;
    if (typeof this.input.setRawMode === "function") this.input.setRawMode(mode);
    return wasRaw;
  }

  /**
   * Show the prompt.
   *
   * `TERM=dumb` takes the non-terminal path even when there is a terminal,
   * because a dumb terminal is one that does not understand the cursor
   * sequences the editor is built from -- drawing on it would leave the escape
   * codes on screen.
   */
  prompt(preserveCursor?: boolean): void {
    if (this.paused) this.resume();
    if (this.terminal && nts_process_env("TERM") !== "dumb") {
      if (!preserveCursor) this.cursor = 0;
      this.#refreshLine();
    } else {
      this.#writeToOutput(this.#prompt);
    }
  }

  protected [kQuestion](query: string, callback: QuestionCallback): void {
    if (this.closed) throw new ERR_USE_AFTER_CLOSE("readline");
    if (this.#questionCallback) {
      // Already asking. Re-showing the prompt is all node does, because the
      // outstanding question owns the callback slot.
      this.prompt();
      return;
    }
    this.#oldPrompt = this.#prompt;
    this.setPrompt(query);
    this.#questionCallback = callback;
    this.prompt();
  }

  protected [kQuestionCancel](): void {
    if (!this.#questionCallback) return;
    this.#questionCallback = null;
    this.setPrompt(this.#oldPrompt);
    this.clearLine();
  }

  /**
   * Promise form shared by `readline/promises` and the legacy constructor's
   * `util.promisify` facade. The symbol keeps this implementation off the
   * public string-keyed API without relying on function-object metadata.
   */
  [kQuestionPromise](query: string, options?: QuestionOptions): Promise<string> {
    const signal = options?.signal;
    if (signal !== undefined) {
      validateAbortSignal(signal, "options.signal");
      if (signal.aborted) {
        return Promise.reject(new AbortError(undefined, { cause: signal.reason }));
      }
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        if (settled) return;
        settled = true;
        if (signal !== undefined) {
          signal.removeEventListener("abort", onAbort);
        }
        this.#questionReject = null;
      };
      const rejectQuestion = (reason: unknown): void => {
        cleanup();
        reject(reason);
      };
      const onAbort = (): void => {
        if (settled) return;
        this[kQuestionCancel]();
        rejectQuestion(new AbortError(undefined, { cause: signal?.reason }));
      };
      const answered = (answer: string): void => {
        if (settled) return;
        cleanup();
        resolve(answer);
      };

      if (signal !== undefined) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.#questionReject = rejectQuestion;
      try {
        this[kQuestion](query, answered);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  #setLine(line = ""): void {
    this.line = line;
    this.#isMultiline = line.includes("\n");
  }

  /** A finished line goes to the outstanding question, or to listeners. */
  #onLine(line: string): void {
    if (this.#questionCallback) {
      const callback = this.#questionCallback;
      this.#questionCallback = null;
      this.setPrompt(this.#oldPrompt);
      callback(line);
    } else {
      this.emit("line", line);
    }
  }

  #beforeEdit(oldText: string, oldCursor: number): void {
    this.#pushToUndoStack(oldText, oldCursor);
  }

  #writeToOutput(stringToWrite: string): void {
    validateString(stringToWrite, "stringToWrite");
    if (this.output !== null && this.output !== undefined) {
      this.output.write(stringToWrite);
    }
  }

  #addHistory(): string {
    return this.#historyManager.add(this.#isMultiline, this.#lastCommandErrored);
  }

  /**
   * Redraw the line.
   *
   * The terminal has no idea what the line is supposed to look like, so this
   * moves back to where the line began, erases everything from there down, and
   * writes it again. Anything less -- trying to patch the visible text in
   * place -- has to be right about the wrapping, and the wrapping depends on
   * the width of every character written so far.
   */
  #refreshLine(): void {
    const line = this.#prompt + this.line;
    const dispPos = this.#getDisplayPos(line);
    const lineCols = dispPos.cols;
    const lineRows = dispPos.rows;
    const cursorPos = this.getCursorPos();

    // Up to the first row of the line before erasing, or the erase would start
    // in the middle of it.
    const prevRows = this.prevRows || 0;
    if (prevRows > 0) moveCursor(this.output, 0, -prevRows);

    cursorTo(this.output, 0);
    clearScreenDown(this.output);

    if (this.#isMultiline) {
      const lines = this.line.split("\n");
      this.#writeToOutput(this.#prompt + lines[0]);
      for (let i = 1; i < lines.length; i++) {
        this.#writeToOutput(`\n${MULTILINE_PROMPT}${lines[i]}`);
      }
    } else {
      this.#writeToOutput(line);
    }

    // A line that ends exactly at the right margin has not made the terminal
    // allocate the next row yet, and the cursor would be placed on a row that
    // does not exist. A space forces it.
    if (lineCols === 0) this.#writeToOutput(" ");

    cursorTo(this.output, cursorPos.cols);

    const diff = lineRows - cursorPos.rows;
    if (diff > 0) moveCursor(this.output, 0, -diff);

    this.prevRows = cursorPos.rows;
  }

  close(): void {
    if (this.closed) return;
    this.pause();
    if (this.terminal) this.#setRawMode(false);
    this.closed = true;
    this.emit("close");
  }

  pause(): this | undefined {
    if (this.closed) throw new ERR_USE_AFTER_CLOSE("readline");
    if (this.paused) return undefined;
    this.input.pause();
    this.paused = true;
    this.emit("pause");
    return this;
  }

  resume(): this | undefined {
    if (this.closed) throw new ERR_USE_AFTER_CLOSE("readline");
    if (!this.paused) return undefined;
    this.input.resume();
    this.paused = false;
    this.emit("resume");
    return this;
  }

  /** Feed input in, as though it had been typed. */
  write(d: string | Buffer | undefined, key?: Key): void {
    if (this.closed) throw new ERR_USE_AFTER_CLOSE("readline");
    if (this.paused) this.resume();
    if (this.terminal) {
      this.#ttyWrite(d, key);
    } else {
      this.#normalWrite(d);
    }
  }

  /**
   * The non-terminal path: decode bytes, split lines, emit them.
   *
   * The `\r\n` handling is the subtle part. The two characters can arrive in
   * separate chunks, and a naive split would report an empty line between
   * them. So the time of a trailing `\r` is remembered, and a `\n` that opens
   * the next chunk within `crlfDelay` is dropped as its other half.
   */
  #normalWrite(b: string | Buffer | undefined): void {
    if (b === undefined) return;
    const decoder = this.#decoder;
    if (decoder === undefined) {
      throw new Error("readline non-terminal decoder invariant violated");
    }
    let string = decoder.write(b);

    if (this.#sawReturnAt && Date.now() - this.#sawReturnAt <= this.crlfDelay) {
      if (string.codePointAt(0) === 10) string = string.slice(1);
      this.#sawReturnAt = 0;
    }

    if (!string) return;

    // The plain split when the chunk holds none of the rare endings, because
    // this runs on every chunk of every piped stream and the regular
    // expression is much the more expensive of the two.
    const lines = string.includes("\r") || string.includes("\u2028") || string.includes("\u2029")
      ? string.split(LINE_ENDING)
      : string.split("\n");

    const lastIndex = lines.length - 1;
    if (lastIndex === 0) {
      // No ending in this chunk, so the line is unfinished and waits.
      this.#lineBuffer += string;
      return;
    }

    this.#sawReturnAt = string.endsWith("\r") ? Date.now() : 0;

    let first = lines[0] ?? "";
    if (this.#lineBuffer) first = this.#lineBuffer + first;
    // Either empty, or the beginning of a line whose end has not arrived.
    this.#lineBuffer = lines[lastIndex] ?? "";

    this.#onLine(first);
    for (let i = 1; i < lastIndex; i++) {
      const line = lines[i];
      if (line !== undefined) this.#onLine(line);
    }
  }

  /**
   * Insert text at the cursor.
   *
   * Three cases, and the difference between them is how much has to be
   * redrawn. Appending at the end of a line that did not wrap needs only the
   * new characters written; anything that changes the wrapping, or that
   * inserts into the middle, needs the whole line.
   */
  #insertString(c: string): void {
    this.#beforeEdit(this.line, this.cursor);

    if (!this.isCompletionEnabled) {
      // Mid-paste: the cheapest path, because the redraw happens once at the
      // end rather than once per character.
      if (this.cursor < this.line.length) {
        const beg = this.line.slice(0, this.cursor);
        const end = this.line.slice(this.cursor);
        this.line = beg + c + end;
      } else {
        this.line += c;
      }
      this.cursor += c.length;
      this.#writeToOutput(c);
      return;
    }

    if (this.cursor < this.line.length) {
      const beg = this.line.slice(0, this.cursor);
      const end = this.line.slice(this.cursor);
      this.#setLine(beg + c + end);
      this.cursor += c.length;
      this.#refreshLine();
    } else {
      const oldPos = this.getCursorPos();
      this.line += c;
      this.cursor += c.length;
      const newPos = this.getCursorPos();
      if (oldPos.rows < newPos.rows) this.#refreshLine();
      else this.#writeToOutput(c);
    }
  }

  // -- word and character editing -------------------------------------------

  #wordLeft(): void {
    if (this.cursor === 0) return;
    // Matched against the reversed text so the pattern is anchored at the
    // start. Searching backwards from the cursor with a right-anchored pattern
    // is quadratic, and a long line pays it on every Ctrl+Left.
    const leading = this.line.slice(0, this.cursor);
    const reversed = Array.from(leading).reverse().join("");
    const match = /^\s*(?:[^\w\s]+|\w+)?/.exec(reversed);
    this.#moveCursor(-(match?.[0].length ?? 0));
  }

  #wordRight(): void {
    if (this.cursor >= this.line.length) return;
    const trailing = this.line.slice(this.cursor);
    const match = /^(?:\s+|[^\w\s]+|\w+)\s*/.exec(trailing);
    this.#moveCursor(match?.[0].length ?? 0);
  }

  #deleteLeft(): void {
    if (this.cursor > 0 && this.line.length > 0) {
      this.#beforeEdit(this.line, this.cursor);
      const charSize = charLengthLeft(this.line, this.cursor);
      this.line = this.line.slice(0, this.cursor - charSize) + this.line.slice(this.cursor);
      this.cursor -= charSize;
      this.#refreshLine();
    }
  }

  #deleteRight(): void {
    if (this.cursor < this.line.length) {
      this.#beforeEdit(this.line, this.cursor);
      const charSize = charLengthAt(this.line, this.cursor);
      this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + charSize);
      this.#refreshLine();
    }
  }

  #deleteWordLeft(): void {
    if (this.cursor === 0) return;
    this.#beforeEdit(this.line, this.cursor);
    let leading = this.line.slice(0, this.cursor);
    const reversed = Array.from(leading).reverse().join("");
    const match = /^\s*(?:[^\w\s]+|\w+)?/.exec(reversed);
    leading = leading.slice(0, leading.length - (match?.[0].length ?? 0));
    this.line = leading + this.line.slice(this.cursor);
    this.cursor = leading.length;
    this.#refreshLine();
  }

  #deleteWordRight(): void {
    if (this.cursor >= this.line.length) return;
    this.#beforeEdit(this.line, this.cursor);
    const trailing = this.line.slice(this.cursor);
    const match = /^(?:\s+|\W+|\w+)\s*/.exec(trailing);
    this.line = this.line.slice(0, this.cursor) + trailing.slice(match?.[0].length ?? 0);
    this.#refreshLine();
  }

  #deleteLineLeft(): void {
    this.#beforeEdit(this.line, this.cursor);
    const del = this.line.slice(0, this.cursor);
    this.#setLine(this.line.slice(this.cursor));
    this.cursor = 0;
    this.#pushToKillRing(del);
    this.#refreshLine();
  }

  #deleteLineRight(): void {
    this.#beforeEdit(this.line, this.cursor);
    const del = this.line.slice(this.cursor);
    this.#setLine(this.line.slice(0, this.cursor));
    this.#pushToKillRing(del);
    this.#refreshLine();
  }

  #pushToKillRing(del: string): void {
    // Repeating the newest entry is not a new deletion; it is usually the
    // result of pressing the same key twice on an already-empty region.
    if (!del || del === this.#killRing[0]) return;
    this.#killRing.unshift(del);
    this.#killRingCursor = 0;
    while (this.#killRing.length > MAX_KILL_RING) this.#killRing.pop();
  }

  #yank(): void {
    if (this.#killRing.length > 0) {
      this.#yanking = true;
      const killed = this.#killRing[this.#killRingCursor];
      if (killed === undefined) return;
      this.#insertString(killed);
    }
  }

  /** Replace what was just yanked with the next-oldest deletion. */
  #yankPop(): void {
    if (!this.#yanking) return;
    if (this.#killRing.length <= 1) return;

    const lastYank = this.#killRing[this.#killRingCursor];
    if (lastYank === undefined) return;
    this.#killRingCursor++;
    if (this.#killRingCursor >= this.#killRing.length) this.#killRingCursor = 0;
    const currentYank = this.#killRing[this.#killRingCursor];
    if (currentYank === undefined) return;

    const head = this.line.slice(0, this.cursor - lastYank.length);
    const tail = this.line.slice(this.cursor);
    this.#setLine(head + currentYank + tail);
    this.cursor = head.length + currentYank.length;
    this.#refreshLine();
  }

  // -- undo -----------------------------------------------------------------

  #pushToUndoStack(text: string, cursor: number): void {
    if (this.#undoStack.push({ text, cursor }) > MAX_UNDO_REDO_STACK) {
      this.#undoStack.shift();
    }
  }

  #undo(): void {
    if (this.#undoStack.length <= 0) return;
    this.#redoStack.push({ text: this.line, cursor: this.cursor });
    const entry = this.#undoStack.pop();
    if (entry === undefined) return;
    this.#setLine(entry.text);
    this.cursor = entry.cursor;
    this.#refreshLine();
  }

  #redo(): void {
    if (this.#redoStack.length <= 0) return;
    this.#undoStack.push({ text: this.line, cursor: this.cursor });
    const entry = this.#redoStack.pop();
    if (entry === undefined) return;
    this.#setLine(entry.text);
    this.cursor = entry.cursor;
    this.#refreshLine();
  }

  // -- lines and history ----------------------------------------------------

  clearLine(): void {
    this.#moveCursor(Infinity);
    this.#writeToOutput("\r\n");
    this.#setLine("");
    this.cursor = 0;
    this.prevRows = 0;
  }

  #line(): void {
    const line = this.#addHistory();
    // The undo history belongs to the line being edited, so it ends with it.
    this.#undoStack = [];
    this.#redoStack = [];
    this.clearLine();
    this.#onLine(line);
  }

  /**
   * Move within a multiline entry, or fall through to history.
   *
   * Up and down mean two different things depending on where the cursor is,
   * and the rule is the one every editor uses: move within the text while
   * there is text to move to, and only then leave it.
   */
  #multilineMove(direction: number, splitLines: string[], pos: CursorPos): void {
    const curr = splitLines[pos.rows];
    const down = direction === 1;
    const adj = splitLines[pos.rows + direction];
    if (curr === undefined || adj === undefined) return;
    const promptLen = MULTILINE_PROMPT.length;

    // Clamped to the end of the adjacent line when it is shorter, and the
    // column is remembered so that moving back to a longer line returns to
    // where the cursor visually was rather than where it was clamped to.
    const clamp = down
      ? curr.length - pos.cols + promptLen + adj.length + 1
      : -pos.cols + 1;
    const shouldClamp = pos.cols > adj.length + 1;
    let amountToMove: number;

    if (shouldClamp) {
      if (this.#previousCursorCols === -1) this.#previousCursorCols = pos.cols;
      amountToMove = clamp;
    } else {
      amountToMove = down ? curr.length + 1 : -adj.length - 1;
      if (this.#previousCursorCols !== -1) {
        if (this.#previousCursorCols <= adj.length) {
          amountToMove += this.#previousCursorCols - pos.cols;
          this.#previousCursorCols = -1;
        } else {
          amountToMove = clamp;
        }
      }
    }

    this.#moveCursor(amountToMove);
  }

  #moveDownOrHistoryNext(): void {
    const cursorPos = this.getCursorPos();
    const splitLines = this.line.split("\n");
    if (this.#isMultiline && cursorPos.rows < splitLines.length - 1) {
      this.#multilineMove(1, splitLines, cursorPos);
      return;
    }
    this.#previousCursorCols = -1;
    this.#historyNext();
  }

  #historyNext(): void {
    if (!this.#historyManager.canNavigateToNext()) return;
    this.#beforeEdit(this.line, this.cursor);
    const line = this.#historyManager.navigateToNext(this.#substringSearch ?? undefined);
    if (line === null) return;
    this.#setLine(line);
    this.cursor = this.line.length;
    this.#refreshLine();
  }

  #moveUpOrHistoryPrev(): void {
    const cursorPos = this.getCursorPos();
    if (this.#isMultiline && cursorPos.rows > 0) {
      this.#multilineMove(-1, this.line.split("\n"), cursorPos);
      return;
    }
    this.#previousCursorCols = -1;
    this.#historyPrev();
  }

  #historyPrev(): void {
    if (!this.#historyManager.canNavigateToPrevious()) return;
    this.#beforeEdit(this.line, this.cursor);
    const line = this.#historyManager.navigateToPrevious(this.#substringSearch ?? "");
    if (line === null) return;
    this.#setLine(line);
    this.cursor = this.line.length;
    this.#refreshLine();
  }

  // -- geometry -------------------------------------------------------------

  /**
   * Where the last character of `str` lands, in rows and columns.
   *
   * Not `str.length`: a tab advances to the next multiple of `tabSize`, a
   * combining mark is zero columns wide, and a CJK character or an emoji is
   * two. Getting this wrong puts the cursor in the wrong place, which is the
   * one bug in a line editor a user cannot work around.
   */
  #getDisplayPos(str: string): CursorPos {
    let offset = 0;
    const col = this.columns;
    let rows = 0;
    str = stripVTControlCharacters(str);

    for (const char of str) {
      if (char === "\n") {
        // At least one row, even for an empty line or an unbounded width.
        rows += Math.ceil(offset / col) || 1;
        offset = this.#isMultiline ? MULTILINE_PROMPT.length : 0;
        continue;
      }
      if (char === "\t") {
        offset += this.tabSize - (offset % this.tabSize);
        continue;
      }
      const width = getStringWidth(char, false);
      if (width === 0 || width === 1) {
        offset += width;
      } else {
        // A double-width character cannot straddle the margin, so a single
        // column left at the end of a row is skipped rather than split.
        if ((offset + 1) % col === 0) offset++;
        offset += 2;
      }
    }

    const cols = offset % col;
    rows += (offset - cols) / col;
    return { cols, rows };
  }

  getCursorPos(): CursorPos {
    return this.#getDisplayPos(this.#prompt + this.line.slice(0, this.cursor));
  }

  /** Move the cursor `dx` characters, redrawing only if the row changed. */
  #moveCursor(dx: number): void {
    if (dx === 0) return;
    const oldPos = this.getCursorPos();
    this.cursor += dx;

    if (this.cursor < 0) this.cursor = 0;
    else if (this.cursor > this.line.length) this.cursor = this.line.length;

    const newPos = this.getCursorPos();
    if (oldPos.rows === newPos.rows) {
      moveCursor(this.output, newPos.cols - oldPos.cols, 0);
    } else {
      this.#refreshLine();
    }
  }

  // -- completion -----------------------------------------------------------

  /**
   * Run either completer convention without inspecting the function object.
   *
   * The callback is always supplied. A synchronous completer ignores it and
   * returns a tuple, a promise completer returns a promise, and a callback
   * completer returns `void`. Immediate answers remain immediate, which is
   * observable in the callback API, while promise answers retain their normal
   * microtask boundary.
   */
  #tabComplete(lastKeypressWasTab: boolean): void {
    this.pause();
    const string = this.line.slice(0, this.cursor);
    const completer = this.completer;
    if (completer === undefined) {
      this.resume();
      return;
    }

    let settled = false;
    const settle = (err: unknown, value?: Completion): void => {
      if (settled) return;
      settled = true;
      this.resume();
      if (err) {
        this.#writeToOutput(`Tab completion error: ${inspect(err)}`);
      } else if (value !== undefined) {
        this.#tabCompleter(lastKeypressWasTab, value);
      }
    };
    const receive = (err: unknown, value?: Completion): void => {
      if (this.deferCompletions) {
        Promise.resolve().then(() => settle(err, value));
      } else {
        settle(err, value);
      }
    };

    let result: Completion | Promise<Completion> | void;
    try {
      result = completer(string, receive);
    } catch (err) {
      receive(err);
      return;
    }

    if (result instanceof Promise) {
      result.then(
        (value) => settle(null, value),
        (err) => settle(err),
      );
    } else if (result !== undefined) {
      receive(null, result);
    }
  }

  /**
   * Apply a completion.
   *
   * One Tab completes as far as the matches agree. A second Tab lists them --
   * and the first must not, because a single Tab is a request to finish
   * typing, not to be shown a menu.
   */
  #tabCompleter(lastKeypressWasTab: boolean, value: Completion): void {
    if (!value) return;
    const completions = value[0];
    const completeOn = value[1];
    if (!completions || completions.length === 0) return;

    const prefix = commonPrefix(completions.filter((e) => e !== ""));

    if (prefix.startsWith(completeOn) && prefix.length > completeOn.length) {
      this.#insertString(prefix.slice(completeOn.length));
      return;
    }

    if (!completeOn.startsWith(prefix)) {
      // The completer answered with something that is not an extension of what
      // was typed -- a corrected spelling, or a different casing. What was
      // typed is replaced rather than appended to.
      this.#setLine(
        this.line.slice(0, this.cursor - completeOn.length) +
          prefix +
          this.line.slice(this.cursor),
      );
      this.cursor = this.cursor - completeOn.length + prefix.length;
      this.#refreshLine();
      return;
    }

    if (!lastKeypressWasTab) return;

    this.#beforeEdit(this.line, this.cursor);

    // Laid out in columns as wide as the widest entry plus two. Measured with
    // `getStringWidth` rather than `.length`, because a completion containing
    // anything double-width would otherwise be given a column too narrow for
    // it and the whole table would step sideways.
    const widths = completions.map((e) => getStringWidth(e));
    const width = Math.max(...widths) + 2;
    let maxColumns = Math.floor(this.columns / width) || 1;
    // An output with no width -- a pipe -- has no columns to fit into.
    if (maxColumns === Infinity) maxColumns = 1;

    let output = "\r\n";
    let lineIndex = 0;
    let whitespace = 0;
    for (let i = 0; i < completions.length; i++) {
      const completion = completions[i];
      if (completion === undefined) continue;
      if (completion === "" || lineIndex === maxColumns) {
        output += "\r\n";
        lineIndex = 0;
        whitespace = 0;
      } else {
        // The padding is written *before* the next entry rather than after the
        // previous one, so the last entry on a line has no trailing spaces.
        output += " ".repeat(whitespace);
      }
      if (completion !== "") {
        output += completion;
        whitespace = width - (widths[i] ?? 0);
        lineIndex++;
      } else {
        // An empty string is the completer asking for a break in the list.
        output += "\r\n";
      }
    }
    if (lineIndex !== 0) output += "\r\n\r\n";

    this.#writeToOutput(output);
    this.#refreshLine();
  }

  // -- the key dispatch -----------------------------------------------------

  /**
   * One keystroke, in terminal mode.
   *
   * The shape is a dispatch on the modifiers and then on the key name, and it
   * is long because the bindings are Emacs's and there are a lot of them.
   * Nothing here is clever; the interesting decisions are in the methods it
   * calls.
   */
  #ttyWrite(s: string | Buffer | undefined, key: Key | undefined): void {
    const previousKey = this.#previousKey;
    const k: Key = key ?? {
      sequence: undefined, name: undefined, ctrl: false, meta: false, shift: false,
    };
    this.#previousKey = k;

    // Yanking survives only into a yank-pop, which is the one key that
    // continues it.
    if (!k.meta || k.name !== "y") this.#yanking = false;

    // A bare Up or Down starts a substring search from what has been typed so
    // far, so that history navigation filters rather than replaces. Any other
    // key ends it.
    if ((k.name === "up" || k.name === "down") && !k.ctrl && !k.meta && !k.shift) {
      if (this.#substringSearch === null && !this.#isMultiline) {
        this.#substringSearch = this.line.slice(0, this.cursor);
      }
    } else if (this.#substringSearch !== null) {
      this.#substringSearch = null;
      if (this.history.length === this.historyIndex) this.historyIndex = -1;
    }

    if (typeof k.sequence === "string") {
      switch (k.sequence.codePointAt(0)) {
        case 0x1f: this.#undo(); return;
        case 0x1e: this.#redo(); return;
        default: break;
      }
    }

    // Ignored deliberately: a lone escape is ambiguous and acting on it made
    // the escape key delete things. node-v0.x-archive#2876.
    if (k.name === "escape") return;

    if (k.ctrl && k.shift) {
      switch (k.name) {
        case "backspace": this.#deleteLineLeft(); break;
        case "delete": this.#deleteLineRight(); break;
      }
      return;
    }

    if (k.ctrl) {
      switch (k.name) {
        case "c":
          if (this.listenerCount("SIGINT") > 0) {
            this.emit("SIGINT");
          } else {
            this.close();
            this.#questionReject?.(new AbortError("Aborted with Ctrl+C"));
          }
          break;
        case "h": this.#deleteLeft(); break;
        case "d":
          if (this.cursor === 0 && this.line.length === 0) {
            // Ctrl+D on an empty line is end-of-input, not a deletion.
            this.close();
            this.#questionReject?.(new AbortError("Aborted with Ctrl+D"));
          } else if (this.cursor < this.line.length) {
            this.#deleteRight();
          }
          break;
        case "u": this.#deleteLineLeft(); break;
        case "k": this.#deleteLineRight(); break;
        case "a": this.#moveCursor(-Infinity); break;
        case "e": this.#moveCursor(Infinity); break;
        case "b": this.#moveCursor(-charLengthLeft(this.line, this.cursor)); break;
        case "f": this.#moveCursor(charLengthAt(this.line, this.cursor)); break;
        case "l":
          cursorTo(this.output, 0, 0);
          clearScreenDown(this.output);
          this.#refreshLine();
          break;
        case "n": this.#historyNext(); break;
        case "p": this.#historyPrev(); break;
        case "y": this.#yank(); break;
        // Ctrl+W and Ctrl+Backspace arrive as the same byte, which node has a
        // standing TODO about; both mean delete the word to the left.
        case "w":
        case "backspace": this.#deleteWordLeft(); break;
        case "delete": this.#deleteWordRight(); break;
        case "left": this.#wordLeft(); break;
        case "right": this.#wordRight(); break;
      }
      return;
    }

    if (k.meta) {
      switch (k.name) {
        case "b": this.#wordLeft(); break;
        case "f": this.#wordRight(); break;
        case "d":
        case "delete": this.#deleteWordRight(); break;
        case "backspace": this.#deleteWordLeft(); break;
        case "y": this.#yankPop(); break;
      }
      return;
    }

    // A pending `\r` only matters if an `\n` follows it immediately.
    if (this.#sawReturnAt && k.name !== "enter") this.#sawReturnAt = 0;

    switch (k.name) {
      case "return":
        this.#sawReturnAt = Date.now();
        this.#line();
        break;

      case "enter":
        // The second half of a CRLF, unless enough time has passed that it is
        // a line of its own.
        if (this.#sawReturnAt === 0 || Date.now() - this.#sawReturnAt > this.crlfDelay) {
          this.#line();
        }
        this.#sawReturnAt = 0;
        break;

      case "backspace": this.#deleteLeft(); break;
      case "delete": this.#deleteRight(); break;
      case "left": this.#moveCursor(-charLengthLeft(this.line, this.cursor)); break;
      case "right": this.#moveCursor(charLengthAt(this.line, this.cursor)); break;
      case "home": this.#moveCursor(-Infinity); break;
      case "end": this.#moveCursor(Infinity); break;
      case "up": this.#moveUpOrHistoryPrev(); break;
      case "down": this.#moveDownOrHistoryNext(); break;

      case "tab":
        if (typeof this.completer === "function" && this.isCompletionEnabled) {
          const lastKeypressWasTab = !!previousKey && previousKey.name === "tab";
          void this.#tabComplete(lastKeypressWasTab);
          break;
        }
        // Otherwise a tab is just a character.
        this.#writeCharacters(s);
        break;

      default:
        this.#writeCharacters(s);
        break;
    }
  }

  /**
   * Insert typed text, ending a line wherever the text contains one.
   *
   * Pasted text arrives here as one chunk that may contain newlines, and each
   * one has to finish a line exactly as pressing Enter would.
   */
  #writeCharacters(s: unknown): void {
    if (typeof s !== "string" || !s) return;
    LINE_ENDING.lastIndex = 0;
    let nextMatch: RegExpExecArray | null;
    let lastIndex = 0;
    while ((nextMatch = LINE_ENDING.exec(s)) !== null) {
      this.#insertString(s.slice(lastIndex, nextMatch.index));
      lastIndex = LINE_ENDING.lastIndex;
      this.#line();
      // `#line` can run listeners that use this regular expression, so its
      // position is restored rather than trusted.
      LINE_ENDING.lastIndex = lastIndex;
    }
    if (lastIndex < s.length) this.#insertString(s.slice(lastIndex));
  }

  /**
   * The lines, as an async iterable.
   *
   * `events.on` rather than a queue of our own: it already turns an event into
   * an async iterator, and -- the part that matters -- it applies backpressure,
   * pausing the interface when lines arrive faster than they are consumed. A
   * plain queue would grow without bound, which is how a program that reads
   * slower than its input arrives runs out of memory instead of slowing down.
   *
   * `kFirstEventParam`, because a `line` event carries exactly one argument and
   * the loop should yield the line rather than a one-element array.
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<string> {
    if (this.#lineObjectStream === undefined) {
      this.#lineObjectStream = onEvent<string>(this, "line", {
        close: ["close"],
        highWaterMark: 1024,
        [kFirstEventParam]: true,
      });
    }
    return this.#lineObjectStream;
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/** The callback-oriented `node:readline` public interface. */
export class Interface extends InterfaceBase {
  /**
   * Ask a question and call back with the answer.
   *
   * The prompt is swapped for the query and swapped back when the answer
   * arrives, which is why a second question while one is outstanding does not
   * stack: there is one prompt and one callback.
   */
  question(query: string, callback: QuestionCallback): void;
  question(query: string, options: QuestionOptions, callback: QuestionCallback): void;
  question(
    query: string,
    optionsOrCallback: QuestionOptions | QuestionCallback | null,
    maybeCallback?: unknown,
  ): void {
    let callback: unknown;
    let options: QuestionOptions | undefined;
    if (isQuestionCallback(optionsOrCallback)) {
      callback = optionsOrCallback;
    } else if (optionsOrCallback !== null && typeof optionsOrCallback === "object") {
      options = optionsOrCallback;
      callback = maybeCallback;
    } else {
      callback = maybeCallback;
    }

    if (options?.signal) {
      validateAbortSignal(options.signal, "options.signal");
      if (options.signal.aborted) return;
      const onAbort = (): void => { this[kQuestionCancel](); };
      options.signal.addEventListener("abort", onAbort, { once: true });
      const cleanup = (): void => options.signal?.removeEventListener("abort", onAbort);
      if (isQuestionCallback(callback)) {
        const originalCallback = callback;
        callback = (answer: string): void => { cleanup(); originalCallback(answer); };
      } else {
        callback = cleanup;
      }
    }

    if (isQuestionCallback(callback)) this[kQuestion](query, callback);
  }
}
