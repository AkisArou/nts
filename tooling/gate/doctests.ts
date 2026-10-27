// An explicit crate list from owed; the full gate defaults to the workspace.
import { spawnSync } from "node:child_process";

const crates = (process.env.NTS_DOCTEST_CRATES ?? "").trim().split(/\s+/).filter(Boolean);
if (crates.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) throw new Error("invalid NTS_DOCTEST_CRATES");
const args = ["test", "--doc", "--no-fail-fast", ...(crates.length ? [...new Set(crates)].flatMap(name => ["-p", name]) : ["--workspace"])];
const run = spawnSync("cargo", args, { stdio: "inherit", env: { ...process.env, NTS_CHECKERS: "1" } });
if (run.error) console.error(run.error.message);
if (run.status !== 0) console.error(`doctests: cargo exited ${run.status ?? run.signal ?? "without status"}`);
process.exitCode = run.status === 0 ? 0 : 1;
