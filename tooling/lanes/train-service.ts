// The controller belongs to the lander, never to a submitting service.
import {durableRecord} from "./durable-record.ts";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { systemdEnvironment } from "../gate/environment.ts";
import { gateCommand } from "../gate/affinity.ts";
import { toolingSliceArgs } from "../gate/tooling-slice.ts";
import { GateResource } from "./gate-resource.ts";
export type TrainOwner = { version: 1; id: string; unit: string; root: string; directory: string; tree: string; sha: string; bootstrap?: string; phase: "starting" | "running" | "retiring"; archive?: string; log: string; trace: string };
function checked(command: string, args: string[], cwd?: string): string {
  const r = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (r.status !== 0 || r.error) throw new Error(`${command}: ${r.stderr || r.error?.message}`);
  return r.stdout.trim();
}
const save = durableRecord;
export function trainOwner(state: string): TrainOwner | null {
  try {
    const owner=JSON.parse(readFileSync(join(state,"train-owner.json"),"utf8"));
    if(owner.version!==1 || !/^[0-9]+-[a-f0-9]+$/.test(owner.id) || !([`nts-land-train-${owner.id}`,`nts-test-land-train-${owner.id}`].includes(owner.unit)) || owner.directory!==join(state,"trains",owner.id) || owner.tree!==join(owner.directory,"tree") || !["starting","running","retiring"].includes(owner.phase)) throw new Error("invalid train owner record");
    return owner;
  } catch(error) { if(error.code==="ENOENT")return null;throw error; }
}
export function trainUnitState(unit: string): string {
  const r = spawnSync("systemctl", ["--user", "show", unit, "--property=ActiveState", "--value"], { encoding: "utf8", timeout: 2000 });
  if (r.error) throw r.error;
  if (r.stdout.trim()) return r.stdout.trim();
  if (r.status !== 0) throw new Error(`cannot read train unit ${unit}: ${r.stderr}`);
  return "inactive";
}
export async function withTrainLaunchLock<T>(state: string, operation: () => T): Promise<T> {
  let lock: GateResource | null;
  while (!(lock = GateResource.tryAcquire(join(state, "train-launch.lock")))) await pause(100);
  try { return operation(); } finally { lock.close(); }
}
/** Repeated calls coalesce. A retiring controller cannot swallow a late entry. */
export async function ensureTrain(root: string, state: string, sourceTree: string, submitted?:string): Promise<TrainOwner> {
  mkdirSync(state, { recursive: true });
  return withTrainLaunchLock(state, () => {
    const previous = trainOwner(state);
    if(previous&&existsSync(join(state,"train-abandonments",previous.id+".json"))&&JSON.parse(readFileSync(join(state,"frozen-train.json"),"utf8")).phase!=="abandoned")throw new Error("finish the recorded operator abandonment before starting a service");
    if (previous && previous.phase !== "retiring" && ["active", "activating", "deactivating"].includes(trainUnitState(previous.unit))) return previous;
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const directory = join(state, "trains", id), tree = join(directory, "tree");
    mkdirSync(directory, { recursive: true });
    const main = checked("git", ["rev-parse", "main"], root);
    const current = spawnSync("git",["cat-file","-e",`${main}:tooling/lanes/train-service.ts`],{cwd:root});
    // Only this component's first strict landing bootstraps from its candidate.
    // Thereafter queued branches can never choose an old controller revision.
    if(current.status!==0&&!submitted)throw new Error("the service bootstrap requires its exact submitted commit");
    const sha = current.status === 0 ? main : checked("git", ["rev-parse", "--verify", `${submitted}^{commit}`], sourceTree);
    checked("git",["cat-file","-e",`${sha}:tooling/lanes/train-service.ts`],root);
    const owner: TrainOwner = { version: 1, id, unit: `${process.env.NTS_LAND_HOME ? "nts-test-land-train" : "nts-land-train"}-${id}`, root, directory, tree, sha, ...(current.status===0?{}:{bootstrap:sha}), phase: "starting", log: join(directory, "unit.log"), trace: join(directory, "train.log") };
    // Archive before creating the worktree; cleanup can never lose its code.
    checked("git", ["update-ref", `refs/archive/land-trains/${id}`, sha, "0".repeat(sha.length)], root);
    checked("git", ["worktree", "add", "--detach", tree, sha], root);
    checked("sh", [join(tree, "tooling/lanes/inputs.sh"), "lane", root, tree], root);
    save(join(directory, "owner.json"), owner);
    save(join(state, "train-owner.json"), owner);
    const quote = (value: string) => '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%") + '"';
    const cleanup = gateCommand(process.execPath, [join(tree, "tooling/lanes/train-service.ts"), "--cleanup", directory]);
    // This supervisor is copied outside the controller tree. It never reads
    // a script that a later boundary checks out underneath it.
    const supervisor = join(directory, "supervisor.sh");
    writeFileSync(supervisor, `#!/bin/sh
set -eu
exec 8>>"$1"
exec 9>>"$2"
export NTS_GATE_LOCK_FD=8 NTS_LAND_LOCKED=1
while :; do
  while :; do
    flock 8
    if flock -n 9; then break; fi
    flock -u 8
    sleep 0.25
  done
  result=0
  "$3" "$4/tooling/lanes/land.ts" --train-worker || result=$?
  flock -u 9
  flock -u 8
  case "$result" in 76) sleep 1 ;; *) exit "$result" ;; esac
done
`);
    const home = dirname(dirname(state));
    const launch = gateCommand("sh", [supervisor, join(home,".cache/nts-parallel-20261004/mainctl/gate-tree.lock"), join(home,".cache/nts-land.lock"), process.execPath, tree]);
    try {
      checked("systemd-run", ["--user", "--collect", "--quiet", ...toolingSliceArgs(), `--unit=${owner.unit}`, `--working-directory=${tree}`,
        "--property=LimitCORE=0", "--property=Restart=on-failure", "--property=RestartSec=2", `--property=StandardOutput=append:${owner.log}`, `--property=StandardError=append:${owner.log}`,
        `--property=ExecStopPost=${[cleanup.command, ...cleanup.args].map(quote).join(" ")}`,
        ...systemdEnvironment(), ...(process.env.NTS_TOOLING_SLICE?[`--setenv=NTS_TOOLING_SLICE=${process.env.NTS_TOOLING_SLICE}`]:[]), `--setenv=NTS_LAND_HOME=${dirname(dirname(state))}`,
        `--setenv=NTS_LAND_TRAIN_UNIT=${owner.unit}`, `--setenv=NTS_LAND_TRAIN_DIRECTORY=${directory}`,
        `--setenv=NTS_LAND_TRAIN_TRACE=${owner.trace}`, launch.command, ...launch.args], root);
    } catch (error) { owner.phase = "retiring"; save(join(state, "train-owner.json"), owner); throw error; }
    return owner;
  });
}
export async function retireTrainOwner(state: string): Promise<void> {
  await withTrainLaunchLock(state, () => {
    const owner = trainOwner(state);
    if (owner?.unit === process.env.NTS_LAND_TRAIN_UNIT) { owner.phase = "retiring"; save(join(state, "train-owner.json"), owner); }
  });
}
export function refreshController(state: string): boolean {
  const owner = trainOwner(state);
  if (!owner || owner.unit !== process.env.NTS_LAND_TRAIN_UNIT) throw new Error("train controller lost its owner manifest");
  const main = checked("git", ["rev-parse", "main"], owner.root);
  if (main === owner.sha || !checked("git",["diff","--name-only",owner.sha,main,"--","tooling/lanes","tooling/gate"],owner.root)) return false;
  // A scratch repository's fake gate does not carry a product lander yet.
  // Production upgrades always contain this entry point on main.
  const entry = spawnSync("git",["cat-file","-e",`${main}:tooling/lanes/train-service.ts`],{cwd:owner.root});
  if (entry.status !== 0) return false;
  const archive=`refs/archive/land-trains/${owner.id}-${main}`;
  const existing=spawnSync("git",["rev-parse","--verify",archive],{cwd:owner.root,encoding:"utf8"});
  if(existing.status!==0)checked("git", ["update-ref", archive, main, "0".repeat(main.length)], owner.root);
  else if(existing.stdout.trim()!==main)throw new Error(`controller archive ${archive} changed`);
  checked("git",["checkout","--detach",main],owner.tree);
  checked("sh",[join(owner.tree,"tooling/lanes/inputs.sh"),"lane",owner.root,owner.tree],owner.root);
  owner.sha=main; owner.archive=archive;
  save(join(owner.directory,"owner.json"),owner); save(join(state,"train-owner.json"),owner);
  return true;
}
export function markTrainRunning(state: string): void {
  const owner = trainOwner(state);
  if (owner?.unit === process.env.NTS_LAND_TRAIN_UNIT) { owner.phase = "running"; save(join(state, "train-owner.json"), owner); }
}
export function cleanupTrain(directory: string): void {
  const owner: TrainOwner = JSON.parse(readFileSync(join(directory, "owner.json"), "utf8"));
  if (owner.version !== 1 || resolve(owner.directory) !== resolve(directory) || owner.tree !== join(directory, "tree")
      || dirname(dirname(directory)) !== join(dirname(dirname(dirname(directory))), "nts-land")
      || !/^(nts-land-train|nts-test-land-train)-[0-9]+-[a-f0-9]+$/.test(owner.unit)) throw new Error("invalid train controller manifest");
  if (process.env.SERVICE_RESULT && process.env.SERVICE_RESULT !== "success") return;
  const state = trainUnitState(owner.unit);
  if (!["inactive", "failed", "deactivating"].includes(state)) throw new Error(`train controller ${owner.unit} is still ${state}`);
  if (!existsSync(owner.tree)) return;
  if (checked("git", ["rev-parse", "HEAD"], owner.tree) !== owner.sha || checked("git", ["rev-parse", owner.archive ?? `refs/archive/land-trains/${owner.id}`], owner.root) !== owner.sha) throw new Error("train controller head or archive changed");
  if (checked("git", ["status", "--porcelain", "--ignore-submodules=all"], owner.tree)) throw new Error("train controller is dirty");
  checked("git", ["worktree", "remove", owner.tree], owner.root);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== "--cleanup" || !process.argv[3]) throw new Error("usage: train-service.ts --cleanup directory");
  cleanupTrain(process.argv[3]);
}
