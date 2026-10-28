import { assertLandingEnvironment, reportLauncherDrops } from "../gate/canonical-environment.ts";
// Queue an immutable submission in a systemd user unit with the gate's environment.
// Run from a login shell: node tooling/lanes/land-unit.ts <commit> <name>
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { systemdEnvironment } from "../gate/environment.ts";
import { gateCommand } from "../gate/affinity.ts";
import { cleanupSubmission, type SubmissionManifest } from "./submission-cleanup.ts";

function checked(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trim();
}

try {
  assertLandingEnvironment();
  reportLauncherDrops(process.env);
  const [asked, name, ...extra] = process.argv.slice(2);
  if (!asked || !name || extra.length || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error("usage: node tooling/lanes/land-unit.ts <commit> <name> (letters, digits, _ or -)");
  }
  const root = checked("git", ["rev-parse", "--show-toplevel"], process.cwd());
  const sha = checked("git", ["rev-parse", "--verify", `${asked}^{commit}`], root);
  const authorBranch = checked("git", ["branch", "--show-current"], root);
  const submissions = join(homedir(), ".cache/nts-land/submissions");
  mkdirSync(submissions, { recursive: true });
  const submission = mkdtempSync(join(submissions, `${name}-${sha.slice(0, 12)}-`));
  const tree = join(submission, "tree");
  const log = join(submission, "land.log");
  const unit = `nts-land-${name}-${submission.split("/").at(-1)!.split("-").at(-1)}`;
  const repo=dirname(checked("git",["rev-parse","--path-format=absolute","--git-common-dir"],root));
  const manifest:SubmissionManifest={version:1,repo,tree,sha,unit,preparingPid:process.pid};
  const recordManifest=()=>writeFileSync(join(submission,"submission.json"),JSON.stringify(manifest,null,2)+"\n");
  recordManifest();
  const cleanup=join(submission,"cleanup.ts");
  writeFileSync(cleanup,readFileSync(new URL("./submission-cleanup.ts",import.meta.url)));
  checked("git", ["worktree", "add", "--detach", tree, sha], root);
  // Owed's language lexers and tree checks use this commit's workspace links,
  // just like a lane tree. Prepare them before the pre-queue dry run.
  checked("sh", [join(tree, "tooling/lanes/inputs.sh"), "lane", root, tree], root);
  const land = join(tree, "tooling/lanes/land.ts");
  const preflight = spawnSync(process.execPath, [land, sha, "--dry-run"], { cwd: tree, stdio: "inherit" });
  if (preflight.error || preflight.status !== 0) {
    manifest.preparingPid=null;recordManifest();
    console.log(cleanupSubmission(repo,submission));
    throw new Error(`landing preflight failed; nothing queued${preflight.error ? `: ${preflight.error.message}` : ""}`);
  }
  const systemdArgument=(s:string)=>'"'+s.replaceAll("\\","\\\\").replaceAll('"','\\"').replaceAll("%","%%")+'"';
  const collector=gateCommand(process.execPath,[cleanup,"--repo",repo,"--post-stop",unit]);
  const after=[collector.command,...collector.args].map(systemdArgument).join(" ");
  checked("systemd-run", [
    "--user", "--collect", "--quiet", `--unit=${unit}`, `--working-directory=${tree}`,
    `--property=StandardOutput=append:${log}`, `--property=StandardError=append:${log}`,
    "--property=LimitCORE=0",
    `--property=ExecStopPost=${after}`,
    `--setenv=NTS_LAND_AUTHOR_BRANCH=${authorBranch}`,
    ...(process.env.NTS_LAND_AUTHOR_ADDRESS ? [`--setenv=NTS_LAND_AUTHOR_ADDRESS=${process.env.NTS_LAND_AUTHOR_ADDRESS}`] : []),
    ...systemdEnvironment(), process.execPath, land, sha,
  ], root);
  manifest.preparingPid=null;recordManifest();
  console.log(`queued ${sha} as ${unit}\nlog: ${log}`);
} catch (error) {
  console.error(`land-unit: ${(error as Error).message}`);
  process.exitCode = 1;
}
