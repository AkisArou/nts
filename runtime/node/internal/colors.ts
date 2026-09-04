// Whether a stream should be written to in colour, from node v24.20.0
// `lib/internal/util/colors.js`.
//
// The question is about the destination, not about us: a terminal renders
// escape sequences and a redirected file stores them as garbage. `FORCE_COLOR`
// overrides the check, which is how CI systems that do render colour but do
// not look like a TTY get coloured output.

import { stderr } from "./stdio.ts";
import { getColorDepth } from "./color-depth.ts";

declare function nts_process_env_has(name: string): boolean;

/** Just enough of a stream for the decision: is it a terminal, and how deep. */
export interface ColorCapableStream {
  isTTY?: boolean | undefined;
  getColorDepth?: (() => number) | undefined;
}

/**
 * The palette node's own diagnostics use, `lib/internal/util/colors.js`.
 *
 * Every entry is empty until `refresh()` decides the destination can render
 * colour, so the code that builds a message concatenates these
 * unconditionally and gets plain text when it should. `refresh` is called
 * again on each use rather than once at startup, because the environment can
 * change under a long-running process.
 */
export const colors: {
  blue: string; green: string; white: string; yellow: string; red: string;
  gray: string; clear: string; reset: string; hasColors: boolean;
} = {
  blue: "", green: "", white: "", yellow: "", red: "",
  gray: "", clear: "", reset: "", hasColors: false,
};

export function refresh(): void {
  if (shouldColorize(stderr)) {
    colors.blue = "\u001b[34m";
    colors.green = "\u001b[32m";
    colors.white = "\u001b[39m";
    colors.yellow = "\u001b[33m";
    colors.red = "\u001b[31m";
    colors.gray = "\u001b[90m";
    colors.clear = "\u001bc";
    colors.reset = "\u001b[0m";
    colors.hasColors = true;
  } else {
    colors.blue = "";
    colors.green = "";
    colors.white = "";
    colors.yellow = "";
    colors.red = "";
    colors.gray = "";
    colors.clear = "";
    colors.reset = "";
    colors.hasColors = false;
  }
}

export function shouldColorize(stream: ColorCapableStream | null | undefined): boolean {
  if (nts_process_env_has("FORCE_COLOR")) {
    return getColorDepth() > 2;
  }
  // Depth 1 is monochrome and depth 4 is 16 colours; `> 2` is node's line
  // between "can show colour" and "cannot".
  return Boolean(stream?.isTTY) && (
    typeof stream?.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
}

// The first read has to be right, and nothing else calls `refresh` before use.
refresh();
