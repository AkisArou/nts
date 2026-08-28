// Whether a stream should be written to in colour, from node v24.20.0
// `lib/internal/util/colors.js`.
//
// The question is about the destination, not about us: a terminal renders
// escape sequences and a redirected file stores them as garbage. `FORCE_COLOR`
// overrides the check, which is how CI systems that do render colour but do
// not look like a TTY get coloured output.

declare function nts_process_env(name: string): string;
declare function nts_process_env_has(name: string): boolean;
declare function nts_stdio_color_depth(): number;

/** Just enough of a stream for the decision: is it a terminal, and how deep. */
export interface ColorCapableStream {
  isTTY?: boolean | undefined;
  getColorDepth?: (() => number) | undefined;
}

export function shouldColorize(stream: ColorCapableStream | null | undefined): boolean {
  if (nts_process_env_has("FORCE_COLOR")) {
    return nts_stdio_color_depth() > 2;
  }
  // Depth 1 is monochrome and depth 4 is 16 colours; `> 2` is node's line
  // between "can show colour" and "cannot".
  return Boolean(stream?.isTTY) && (
    typeof stream?.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
}
