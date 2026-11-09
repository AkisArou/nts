// How a commit names its task's issue (docs/workflow.md, "Tasks"). A commit
// that completes a task says "Fixes #N", which GitHub reads when main reaches
// the commit and closes the issue; one that leaves the task open says
// "Part of #N". The landing service adds "Fixes #N" to a change from issue N's
// branch that names it neither way, and the full check reads these lines to
// find the issue to reopen when it reverts the commit.

/** GitHub's closing keywords, with or without a colon, or "Part of"; then the issue. */
const NAMED = /\b(?:(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?|part of)\s+#([1-9][0-9]*)(?![0-9])/gi;
/** A trailer (`Co-Authored-By: ...`), and a line that continues the one before it. */
const TRAILER = /^[A-Za-z0-9][A-Za-z0-9-]*: /;
const CONTINUED = /^\s+\S/;

/** The issues `message` names as closed or as "Part of", each once, in the order named. */
export function issuesNamed(message: string): number[] {
  return [...new Set([...message.matchAll(NAMED)].map(match => Number(match[1])))];
}

/** `message` with "Fixes #n" as a paragraph of its own, ahead of its trailers when it ends in a block of them. */
export function withFixes(message: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`an issue number is a positive integer, not ${n}`);
  const text = message.trimEnd();
  // The first paragraph is the subject, never a trailer block.
  const cut = text.lastIndexOf("\n\n");
  const last = cut < 0 ? [] : text.slice(cut + 2).split("\n");
  const trailers = last.length > 0 && TRAILER.test(last[0]!) && last.every(line => TRAILER.test(line) || CONTINUED.test(line));
  return trailers ? `${text.slice(0, cut)}\n\nFixes #${n}\n\n${last.join("\n")}\n` : `${text}\n\nFixes #${n}\n`;
}
