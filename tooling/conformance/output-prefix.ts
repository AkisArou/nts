/** A checkpoint from before prefix validation cannot be reclassified safely. */
export const OUTPUT_PREFIX_VERSION = 1;

export interface PrintedOutput { stdout: string; stderr: string; }

const DECLINE = /^nts: (?:refused(?::| at run time:)|out of memory\b)/m;

/** Native diagnostics are outside the JavaScript output being compared. */
export function nativeDecline(stderr: string): boolean {
  return DECLINE.test(stderr);
}

/** No trimming: every character printed before a native stop must match. */
export function outputPrefix(printed: string, node: string): boolean {
  return node.startsWith(printed);
}

export function outputPrefixes(printed: PrintedOutput, node: PrintedOutput): boolean {
  return outputPrefix(printed.stdout, node.stdout) && outputPrefix(printed.stderr, node.stderr);
}

/** Only the final diagnostic is metadata; earlier lookalike lines stay output. */
export function beforeTerminalDiagnostic(stderr: string, kind: "decline" | "uncaught"): string {
  const pattern = kind === "decline" ? DECLINE.source : "^nts: uncaught ";
  const matches = [...stderr.matchAll(new RegExp(pattern, "gm"))];
  const last = matches.at(-1);
  return last ? stderr.slice(0, last.index) : stderr;
}
