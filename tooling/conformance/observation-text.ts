/** Compiler-generated identities move independently of a case's behaviour.
 * Keep source names, source positions, representation widths and observed
 * values. Call this only for diagnostic/validator identities, never answers.
 */
export function normalizeGeneratedNumbers(text: string): string {
  return text.replace(/<\d+(?:,\s*\d+)*>/g, arguments_ => arguments_.replace(/\d+/g, "N"))
    .replace(/\btype \d+\b/g, "type N")
    .replace(/\b(\w*Id)\(\d+\)/g, "$1(N)")
    .replace(/\bnts\.gen\.[\w$]+/g, name => name.replace(/\$\d+\$/g, "$N$")
      .replace(/\.(Type|Tuple)\d+\b/g, ".$1N"));
}

/** JVM's uncaught-exception protocol exposes the class and first message line.
 * Frames and thread names describe the host artifact, so remain in raw rows.
 * nts-owned abort text and wrong-answer output never enter this normalization.
 */
export function stableRuntimeAbortOutput(output: string): string {
  const first = output.split("\n", 1)[0];
  const host = /^Exception in thread "[^"]*" ([\w.$]+)(?::\s*(.*))?$/.exec(first);
  if (host === null) return output;
  return host[1] + (host[2] === undefined ? "" : ": " + normalizeGeneratedNumbers(host[2]));
}

/** Refusal paths name the materialized scratch project, not an observation.
 * A validator's own `at`, line and column fields are deliberately retained.
 */
export function stableCheckText(text: string): string {
  return text.replace(/\b(refused|not emitted|not rendered):\s*\S+:\d+:\d+:\s+/g, "$1: ");
}
