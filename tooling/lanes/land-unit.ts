// Queue an immutable submission in a systemd user unit with the gate's environment.
// Run from a login shell: node tooling/lanes/land-unit.ts <commit> <name>
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { systemdEnvironment } from "../gate/environment.ts";

function checked(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trim();
}

try {
  const [asked, name, ...extra] = process.argv.slice(2);
  if (!asked || !name || extra.length || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error("usage: node tooling/lanes/land-unit.ts <commit> <name> (letters, digits, _ or -)");
  }
  const root = checked("git", ["rev-parse", "--show-toplevel"], process.cwd());
  const sha = checked("git", ["rev-parse", "--verify", `${asked}^{commit}`], root);
  const submissions = join(homedir(), ".cache/nts-land/submissions");
  mkdirSync(submissions, { recursive: true });
  const submission = mkdtempSync(join(submissions, `${name}-${sha.slice(0, 12)}-`));
  const tree = join(submission, "tree");
  const log = join(submission, "land.log");
  checked("git", ["worktree", "add", "--detach", tree, sha], root);
  // Owed's language lexers and tree checks use this commit's workspace links,
  // just like a lane tree. Prepare them before the pre-queue dry run.
  checked("sh", [join(tree, "tooling/lanes/inputs.sh"), "lane", root, tree], root);
  const land = join(tree, "tooling/lanes/land.ts");
  const preflight = spawnSync(process.execPath, [land, sha, "--dry-run"], { cwd: tree, stdio: "inherit" });
  if (preflight.error || preflight.status !== 0) {
    checked("git", ["worktree", "remove", "--force", tree], root);
    throw new Error(`landing preflight failed; nothing queued${preflight.error ? `: ${preflight.error.message}` : ""}`);
  }
  const unit = `nts-land-${name}-${submission.split("/").at(-1)!.split("-").at(-1)}`;
  checked("systemd-run", [
    "--user", "--collect", "--quiet", `--unit=${unit}`, `--working-directory=${tree}`,
    `--property=StandardOutput=file:${log}`, `--property=StandardError=file:${log}`,
    `--property=LimitCORE=${process.env.NTS_COREDUMPS === "1" ? "infinity" : "0"}`,
    ...systemdEnvironment(), process.execPath, land, sha,
  ], root);
  console.log(`queued ${sha} as ${unit}\nlog: ${log}`);
} catch (error) {
  console.error(`land-unit: ${(error as Error).message}`);
  process.exitCode = 1;
}
