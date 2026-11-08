// The warm gate tree has one runner under its existing tree lock. Its next
// runner collects the previous root only after proving that owner is dead.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { durableRecord } from "../durable-record.ts";
import { toolingSlice } from "../tooling-slice.ts";

export type RootIdentity = { group: string; device: string; inode: string };
export type RunOwner = { version: 1; nonce: string; pid: number; start: string; boot: string; slice: string; scope?: RootIdentity };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const boot = () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
function processIdentity(pid: number): { start: string; live: boolean } | undefined {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8"), fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    if (!/^\d+$/.test(fields[19] ?? "")) throw new Error("gate owner has an invalid process identity");
    return { start: fields[19]!, live: fields[0] !== "Z" && fields[0] !== "X" };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
function readOwner(text: string): RunOwner {
  const value = JSON.parse(text) as RunOwner;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid prior gate root receipt");
  const keys = value.scope === undefined ? ["version", "nonce", "pid", "start", "boot", "slice"] : ["version", "nonce", "pid", "start", "boot", "slice", "scope"];
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort()) || value.version !== 1
      || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.start !== "string" || !/^[1-9]\d*$/.test(value.start)
      || typeof value.boot !== "string" || !uuid.test(value.boot)
      || typeof value.nonce !== "string" || !uuid.test(value.nonce) || typeof value.slice !== "string") throw new Error("invalid prior gate root receipt");
  toolingSlice({ NTS_TOOLING_SLICE: value.slice });
  if (value.scope !== undefined && (!value.scope || typeof value.scope !== "object" || Array.isArray(value.scope)
      || JSON.stringify(Object.keys(value.scope).sort()) !== JSON.stringify(["device", "group", "inode"])
      || typeof value.scope.group !== "string" || !value.scope.group.startsWith("/") || !value.scope.group.endsWith(`/${value.slice}`) || value.scope.group.split("/").includes("..")
      || typeof value.scope.device !== "string" || !/^\d+$/.test(value.scope.device)
      || typeof value.scope.inode !== "string" || !/^[1-9]\d*$/.test(value.scope.inode))) throw new Error("invalid prior gate root identity");
  return value;
}

export function reapRunOwner(path: string, reap: (previous: RunOwner) => void): void {
  let prior: string | undefined;
  try { prior = readFileSync(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (prior !== undefined) {
    const previous = readOwner(prior), identity = previous.boot === boot() ? processIdentity(previous.pid) : undefined;
    if (identity?.live && identity.start === previous.start) throw new Error("a live gate runner still owns this tree's step root");
    reap(previous);
    if (readFileSync(path, "utf8") !== prior) throw new Error("gate root receipt changed during stale cleanup");
    rmSync(path);
  }
}

export function claimRunOwner(path: string, slice: string, reap: (previous: RunOwner) => void) {
  mkdirSync(dirname(path), { recursive: true });
  reapRunOwner(path, reap);
  const identity = processIdentity(process.pid);
  if (!identity?.live) throw new Error("current gate owner identity is unavailable");
  const own: RunOwner = { version: 1, nonce: randomUUID(), pid: process.pid, start: identity.start, boot: boot(), slice };
  writeFileSync(path, JSON.stringify(own) + "\n", { flag: "wx", mode: 0o600 });
  const verify = () => { if (readOwner(readFileSync(path, "utf8")).nonce !== own.nonce) throw new Error("gate root receipt changed owners"); };
  return {
    complete(scope: RootIdentity) { verify(); own.scope = scope; durableRecord(path, own); },
    close() { verify(); rmSync(path); },
  };
}
