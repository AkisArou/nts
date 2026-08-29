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
import { CSI } from "../../internal/readline-callbacks.ts";
import {
  Interface as CallbackInterface,
  type InterfaceOptions,
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
    typeof (stream as WritableLike).write === "function"
  );
}

export class Interface extends CallbackInterface {
  /**
   * Ask, and resolve with the answer.
   *
   * The rejection path is the reason this is not a two-line wrapper: closing
   * the interface while a question is outstanding has to reject rather than
   * leave the promise pending forever, and Ctrl+C and Ctrl+D both close.
   */
  override question(query: string, options?: QuestionOptions): Promise<string>;
  override question(query: string, callback: (answer: string) => void): void;
  override question(
    query: string,
    options: QuestionOptions,
    callback: (answer: string) => void,
  ): void;
  override question(
    query: string,
    optionsOrCallback?: QuestionOptions | ((answer: string) => void),
    maybeCallback?: (answer: string) => void,
  ): Promise<string> | void {
    // The callback forms are the base class's and still work. Node's promises
    // interface rejects them -- it treats the callback as an options object
    // and fails validation -- and the difference is forced rather than chosen:
    // an override has to accept everything the method it overrides accepts.
    if (typeof optionsOrCallback === "function") {
      super.question(query, optionsOrCallback);
      return;
    }
    if (maybeCallback !== undefined) {
      super.question(query, optionsOrCallback as QuestionOptions, maybeCallback);
      return;
    }
    const options = optionsOrCallback;

    return new Promise<string>((resolve, reject) => {
      const onClose = (): void => {
        reject(new Error("The question was cancelled because the interface closed"));
      };
      this.once("close", onClose as never);

      const answered = (answer: string): void => {
        this.removeListener("close", onClose as never);
        resolve(answer);
      };

      if (options?.signal) {
        super.question(query, options, answered);
      } else {
        super.question(query, answered);
      }
    });
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
      dir < 0 ? CSI.kClearToLineBeginning : dir > 0 ? CSI.kClearToLineEnd : CSI.kClearLine,
    );
    return this;
  }

  clearScreenDown(): this {
    this.#queue(CSI.kClearScreenDown);
    return this;
  }

  /** Write everything recorded so far, as one. */
  commit(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.#todo.length === 0) {
        resolve();
        return;
      }
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

export function createInterface(
  options: InterfaceOptions | unknown,
  ...rest: unknown[]
): Interface {
  return new Interface(options as InterfaceOptions, ...rest);
}
