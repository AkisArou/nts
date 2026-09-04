// `node:readline/promises`, from node v24.20.0
// `lib/internal/readline/promises.js` and `lib/readline/promises.js`.
//
// Two unrelated things share this module, which is worth saying because the
// name suggests one.
//
// `Interface.question` returning a promise is the obvious half: the same
// question, awaited rather than called back.
//
// `Readline` is not about promises at all. It is a batch of cursor operations
// that are written in one go. Every escape sequence written separately is a
// separate `write` to the terminal, and a terminal redrawing between them
// flickers -- so the sequences are collected and committed together. `commit`
// returns a promise only because writing does.

import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";
import { validateBoolean, validateInteger } from "../../internal/validators.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  kClearLine,
  kClearScreenDown,
  kClearToLineBeginning,
  kClearToLineEnd,
} from "../../internal/readline-callbacks.ts";
import {
  InterfaceBase,
  kQuestionPromise,
  type Completer,
  type InputStream,
  type InterfaceOptions,
  type OutputStream,
  type QuestionOptions,
} from "./interface.ts";

const CSI_ = "\u001b[";

interface WritableLike {
  write(chunk: string, callback?: (error?: Error | null) => void): unknown;
  writable?: boolean;
}

function isWritable(stream: unknown): stream is WritableLike {
  return (
    typeof stream === "object" &&
    stream !== null &&
    "write" in stream &&
    typeof stream.write === "function"
  );
}

export class Interface extends InterfaceBase {
  protected override deferCompletions = true;

  /** Ask, and resolve with the answer. */
  question(query: string, options?: QuestionOptions): Promise<string> {
    return this[kQuestionPromise](query, options);
  }
}

export interface ReadlineOptions {
  /** Write each operation on the next tick instead of waiting for `commit`. */
  autoCommit?: boolean | undefined;
}

/**
 * A batch of cursor operations.
 *
 * Each method records a sequence and returns `this`, so a sequence of moves
 * reads as one statement and reaches the terminal as one write.
 */
export class Readline {
  #stream: WritableLike;
  #todo: string[] = [];
  #autoCommit = false;

  constructor(stream: WritableLike, options?: ReadlineOptions) {
    if (!isWritable(stream)) throw new ERR_INVALID_ARG_TYPE("stream", "Writable", stream);
    this.#stream = stream;
    if (options?.autoCommit != null) {
      validateBoolean(options.autoCommit, "options.autoCommit");
      this.#autoCommit = options.autoCommit;
    }
  }

  #queue(data: string): void {
    // Deferred rather than written here, so that `autoCommit` still batches
    // whatever a single turn produced instead of writing mid-expression.
    if (this.#autoCommit) nextTick(() => { this.#stream.write(data); });
    else this.#todo.push(data);
  }

  /** Absolute placement. Column only, when `y` is omitted. */
  cursorTo(x: number, y?: number): this {
    validateInteger(x, "x");
    if (y != null) validateInteger(y, "y");
    // One-based, because that is what the terminal counts from.
    this.#queue(y == null ? `${CSI_}${x + 1}G` : `${CSI_}${y + 1};${x + 1}H`);
    return this;
  }

  /** Relative movement. */
  moveCursor(dx: number, dy: number): this {
    if (dx || dy) {
      validateInteger(dx, "dx");
      validateInteger(dy, "dy");
      let data = "";
      if (dx < 0) data += `${CSI_}${-dx}D`;
      else if (dx > 0) data += `${CSI_}${dx}C`;
      if (dy < 0) data += `${CSI_}${-dy}A`;
      else if (dy > 0) data += `${CSI_}${dy}B`;
      this.#queue(data);
    }
    return this;
  }

  /** `-1` left of the cursor, `1` right of it, `0` the whole line. */
  clearLine(dir: -1 | 0 | 1): this {
    validateInteger(dir, "dir", -1, 1);
    this.#queue(
      dir < 0 ? kClearToLineBeginning : dir > 0 ? kClearToLineEnd : kClearLine,
    );
    return this;
  }

  clearScreenDown(): this {
    this.#queue(kClearScreenDown);
    return this;
  }

  /** Write everything recorded so far, as one. */
  commit(): Promise<void> {
    return new Promise<void>((resolve) => {
      const data = this.#todo.join("");
      this.#todo = [];
      this.#stream.write(data, () => resolve());
    });
  }

  /** Discard everything recorded so far. */
  rollback(): this {
    this.#todo = [];
    return this;
  }
}

export function createInterface(options: InterfaceOptions): Interface;
export function createInterface(
  input: InputStream,
  output?: OutputStream | null,
  completer?: Completer,
  terminal?: boolean,
): Interface;
export function createInterface(
  options: InterfaceOptions | InputStream,
  output?: OutputStream | null,
  completer?: Completer,
  terminal?: boolean,
): Interface {
  if ("input" in options) {
    return new Interface(options);
  }
  return new Interface(options, output, completer, terminal);
}
