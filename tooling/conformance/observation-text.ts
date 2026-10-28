/** Compiler-generated identities move independently of a case's behaviour.
 * Keep source names, source positions, representation widths and observed
 * values. Call this only for diagnostic/validator identities, never answers.
 */
export function normalizeGeneratedNumbers(text: string): string {
  return text.replace(/<\d+(?:,\s*\d+)*>/g, arguments_ => arguments_.replace(/\d+/g, "N"))
    .replace(/\btype \d+\b/g, "type N")
    .replace(/\b(\w*Id)\(\d+\)/g, "$1(N)");
}

/** Refusal paths name the materialized scratch project, not an observation.
 * A validator's own `at`, line and column fields are deliberately retained.
 */
export function stableCheckText(text: string): string {
  return text.replace(/\b(refused|not emitted|not rendered):\s*\S+:\d+:\d+:\s+/g, "$1: ");
}
