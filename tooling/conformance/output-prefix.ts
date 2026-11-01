/** Native diagnostics are outside the JavaScript output being compared. */
export function nativeDecline(stderr: string): boolean {
  return /^nts: refused(?::| at run time:)/m.test(stderr);
}

/** No trimming: every character printed before a native stop must match. */
export function outputPrefix(printed: string, node: string): boolean {
  return node.startsWith(printed);
}
