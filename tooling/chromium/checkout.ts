// Where the lane's inputs that no commit carries are. A lane works in its own
// worktree (docs/contributing/workflow.md), and there Chromium's source -- a submodule of
// tens of gigabytes -- is an empty directory, and depot_tools (gitignored) is
// absent: a symlink in the submodule's place breaks `git status` in the tree,
// and a checkout per tree is out of the question at that size. The one real
// copy is in the checkout every worktree shares. What a commit does carry --
// .gclient, upstream.lock.json -- is read from the tree's own copy.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

/**
 * The checkout every worktree of this repository hangs off: git's common
 * directory is its `.git`, from the checkout itself or from any worktree.
 */
export function sharedCheckout(root: string): string {
  const common = execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  return dirname(common);
}

/**
 * Chromium's source (`src/`), where the lane stages, builds and reads Blink:
 * the shared checkout's, or the directory NTS_CHROMIUM_SRC names.
 */
export function chromiumSource(root: string): string {
  const named = process.env.NTS_CHROMIUM_SRC;
  return named ? resolve(named) : resolve(sharedCheckout(root), "third_party/chromium/src");
}

/**
 * The records of the shared checkout and its builds -- the writer lock, the
 * sync manifest, each profile's build record and log, the baseline smoke --
 * kept beside the checkout they describe, not in the tree that ran the tool:
 * there is one Chromium source, so there is one lock. What a tree produces
 * itself (its compiled program, its smoke and benchmark runs) stays in its own
 * `target/chromium`.
 */
export function chromiumState(root: string): string {
  return resolve(sharedCheckout(root), "target/chromium");
}

/** The gclient root around it, which holds depot_tools beside `src/`. */
export function chromiumVendor(root: string): string {
  return dirname(chromiumSource(root));
}
