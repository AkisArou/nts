// Line history, from node v24.20.0 `lib/internal/repl/history.js`.
//
// The in-memory half of what node calls `ReplHistory`. The other half persists
// to a file and belongs to the REPL: node only passes the options that turn it
// on from there, and a line editor reading a dotfile in a user's home directory
// because it was constructed is not behaviour `node:readline` should have.
//
// Newest first. It reads backwards -- index 0 is the most recent line -- and
// that is what makes the arrow keys simple: pressing Up walks forward through
// the array, which is the direction the array already runs in. Node's file
// format has the same order for the same reason.

import { reverseString } from "./utils.ts";

/** Node's default, and small enough that it is worth saying out loud. */
const DEFAULT_HISTORY_SIZE = 30;

interface HistoryContext {
  line: string;
  emit(event: string, ...args: unknown[]): unknown;
}

export interface HistoryOptions {
  size?: number | undefined;
  history?: string[] | undefined;
  removeHistoryDuplicates?: boolean | undefined;
}

export class History {
  #context: HistoryContext;
  #history: string[];
  #size: number;
  #index = -1;
  #removeDuplicates: boolean;

  constructor(context: HistoryContext, options: HistoryOptions = {}) {
    this.#context = context;
    this.#removeDuplicates = options.removeHistoryDuplicates || false;
    // Node also falls back to `context.historySize`, which only the REPL sets
    // before constructing this. Reading it here would be circular: the
    // interface's `historySize` is this object's `size`, and this object does
    // not exist yet.
    this.#size = options.size ?? DEFAULT_HISTORY_SIZE;
    this.#history = options.history ?? [];
  }

  get size(): number { return this.#size; }
  get history(): string[] { return this.#history; }
  set history(value: string[]) { this.#history = value; }
  get index(): number { return this.#index; }
  set index(value: number) { this.#index = value; }

  /**
   * Record the current line, and return what should be shown for it.
   *
   * A line is not added when it is empty, when it is only whitespace, or when
   * it repeats the line above it -- those are the three cases where an entry
   * would make the history worse rather than longer.
   */
  add(isMultiline = false, lastCommandErrored = false): string {
    const line = this.#context.line;
    if (line.length === 0) return "";
    // Size zero is how history is switched off, and the line still comes back
    // so that the caller does not have to know which mode it is in.
    if (this.#size === 0) return line;
    if (line.trim().length === 0) return line;

    if (isMultiline && this.#index === -1) {
      // Each line of a multiline entry was added as it was typed; the finished
      // entry replaces them rather than joining them.
      this.#history.shift();
    } else if (lastCommandErrored) {
      // The previous line is being edited to fix it, so the broken version
      // should not survive alongside the correction.
      this.#history.shift();
    }

    // Stored with the line breaks reversed, because a multiline entry occupies
    // one line of the history file and has to be recoverable from it.
    const normalized = reverseString(line, "\n", "\r");

    if (this.#history.length === 0 || this.#history[0] !== normalized) {
      if (this.#removeDuplicates) {
        const duplicate = this.#history.indexOf(normalized);
        if (duplicate !== -1) this.#history.splice(duplicate, 1);
      }
      this.#history.unshift(normalized);
      if (this.#history.length > this.#size) this.#history.pop();
    }

    this.#index = -1;
    const first = this.#history[0] as string;
    const finalLine = isMultiline ? reverseString(first) : first;

    // Emitted so a listener can edit the array -- dropping an entry that turned
    // out to be a password, for instance. It has to happen after the entry is
    // in and before anyone persists it.
    this.#context.emit("history", this.#history);

    return finalLine;
  }

  canNavigateToNext(): boolean {
    return this.#index > -1 && this.#history.length > 0;
  }

  /**
   * Walk towards the present, optionally only among lines starting with
   * `substringSearch`.
   *
   * Lines equal to what is already on screen are skipped, so that holding a
   * key does not appear to stop working on a repeated entry.
   */
  navigateToNext(substringSearch?: string): string | null {
    if (!this.canNavigateToNext()) return null;
    const search = substringSearch || "";
    let index = this.#index - 1;

    while (
      index >= 0 &&
      (!(this.#history[index] as string).startsWith(search) ||
        this.#context.line === this.#history[index])
    ) {
      index--;
    }

    this.#index = index;
    // Past the newest entry is the search text itself, which is what the user
    // had typed before they started walking backwards.
    if (index === -1) return search;
    return reverseString(this.#history[index] as string, "\r", "\n");
  }

  canNavigateToPrevious(): boolean {
    return this.#history.length !== this.#index && this.#history.length > 0;
  }

  /** Walk towards the past, under the same rules. */
  navigateToPrevious(substringSearch = ""): string | null {
    if (!this.canNavigateToPrevious()) return null;
    const search = substringSearch || "";
    let index = this.#index + 1;

    while (
      index < this.#history.length &&
      (!(this.#history[index] as string).startsWith(search) ||
        this.#context.line === this.#history[index])
    ) {
      index++;
    }

    this.#index = index;
    if (index === this.#history.length) return search;
    return reverseString(this.#history[index] as string, "\r", "\n");
  }
}
