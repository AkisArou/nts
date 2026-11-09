// A task's branch names its issue (docs/workflow.md, Tasks): `<N>` or
// `<N>-<slug>`, where N is the GitHub issue's number. Only N carries meaning;
// the slug is for people. The pool takes a tree on it (pool.ts take --issue),
// the hourly count names it while issue N is open, and the landing check reads
// N from it, all through this one module so none of them can disagree.

/** The branch rule: a positive issue number without leading zeros, then an optional lower-case slug. */
export const BRANCH = /^([1-9][0-9]*)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

/** A slug from free text: lower-case words joined by dashes, at most `words` of them. */
export function slugOf(text: string, words = 6): string {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).slice(0, words).join("-");
}

/** Issue N's branch, with an optional slug. */
export function issueBranch(n: number, slug?: string): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`an issue number is a positive integer, not ${n}`);
  const tail = slug === undefined ? "" : slugOf(slug, Number.POSITIVE_INFINITY);
  const branch = tail ? `${n}-${tail}` : String(n);
  if (!BRANCH.test(branch)) throw new RangeError(`not a task branch: ${branch}`);
  return branch;
}

/** The issue a branch belongs to, or null when the branch is not a task branch. */
export function issueOfBranch(branch: string): number | null {
  const m = BRANCH.exec(branch);
  return m ? Number(m[1]) : null;
}
