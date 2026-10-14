// How one program `emit-jvm` wrote is run, the way a runner of thousands of
// them wants it run: `nts.rt.NtsMain` over its classes, started from a
// class-data archive of the runtime jar.
//
//   import { jvmRun } from "../jvm/launch.ts";   // [command, args] for one run
//   node tooling/jvm/launch.ts <emitted dir>      run it once, as a runner would
//   node tooling/jvm/launch.ts --self-test <emitted dir>
//
// # Why
//
// A test262 case is one JVM start, and a JVM start is mostly the JVM's own: a
// program printing one line took 29-30 ms with the JDK's default archive. Most
// of the rest is loading and verifying the runtime jar's classes, which are the
// same bytes for every case. An application class-data archive (AppCDS) holds
// them already loaded and verified: 33-35 ms became 27-28 ms on a program
// shaped like a test262 harness (2026-10-15, with `-XX:-UsePerfData`), which
// over a suite is minutes of the inner loop's budget.
//
// # How
//
// One archive per runtime jar, keyed by its hash, under ~/.cache/nts/jvm-cds
// (`NTS_JVM_CDS_DIR` moves it). It is made once, by the first run that needs
// it: the jar copied to a fixed path, the warm-up (`NtsCdsWarm.java`, which
// loads every class in the jar) in a jar of its own, and a dump under
// `-XX:ArchiveClassesAtExit`, written beside the archive's name and renamed
// onto it, so a run that reads it reads a whole one. A run started while the
// archive is being made -- the lock is held -- runs without it rather than
// wait.
//
// **The class path is what the archive is valid for**: one that *begins* with
// the dump's. So it is the cached jar, then the warm-up jar, then the
// program's classes -- the reverse of the order a single run would write, and
// harmless, since the runtime's classes are `nts.rt` and the program's are not.
// The dump runs with the same heap and collector flags as every run, because
// an archive dumped under other ones is refused at start-up.
//
// Every failure falls back to the plain launch, which `-Xshare:auto` also
// does for an archive the JVM will not map: the archive changes how fast a run
// starts and nothing it answers.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The flags of every run, and of the dump the archive is made by. The stack is
 * for a deep test262 recursion, which reaches C's answer only past the JVM's
 * default 1 MB; the heap is fixed rather than a share of a memory cap, which
 * the JVM's own reservations exceed at start-up; the rest keep a start cheap
 * without changing an answer.
 */
export const FLAGS = [
  "-Xmx1g",
  "-Xss512m",
  "-XX:TieredStopAtLevel=1",
  "-XX:+UseSerialGC",
  "-XX:-UsePerfData",
];

const MAIN = ["nts.rt.NtsMain", "nts.gen.Program"];
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Per jar hash, the archive's directory, or `null` where it cannot be made.
 * Not where another process is making it: that run goes without, and the next
 * looks again.
 */
const archives = new Map<string, string | null>();

/** What `build` answers: the directory, a lasting failure, or another's lock. */
type Built = string | null | "busy";

function cacheRoot(): string {
  return process.env.NTS_JVM_CDS_DIR ?? join(homedir(), ".cache", "nts", "jvm-cds");
}

/** The directory holding the archive for the runtime jar at `jar`, made if absent. */
export function archiveFor(jar: string): string | null {
  const bytes = readFileSync(jar);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const known = archives.get(hash);
  if (known !== undefined) {
    return known;
  }
  const dir = join(cacheRoot(), hash);
  const made: Built = existsSync(join(dir, "nts.jsa")) ? dir : build(dir, bytes);
  if (made === "busy") {
    return null;
  }
  archives.set(hash, made);
  return made;
}

/**
 * Make the archive in `dir` for the runtime jar `bytes`, under a lock:
 * `"busy"` where another process holds it, `null` where the dump failed. A
 * failure is written to `failed.txt` and not retried, so a JDK that cannot dump
 * costs one attempt, not one per case.
 */
function build(dir: string, bytes: Buffer): Built {
  mkdirSync(dir, { recursive: true });
  if (existsSync(join(dir, "failed.txt"))) {
    return null;
  }
  const lock = join(dir, "lock");
  try {
    mkdirSync(lock);
  } catch {
    // Being made: a lock older than the dump could take is a dead one.
    if (Date.now() - statSync(lock).mtimeMs < 120_000) {
      return "busy";
    }
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
  }
  const work = mkdtempSync(join(tmpdir(), "nts-jvm-cds-"));
  try {
    const jar = join(dir, "nts-runtime.jar");
    writeFileSync(jar, bytes);
    execFileSync("javac", ["--release", "8", "-nowarn", "-d", work, join(HERE, "NtsCdsWarm.java")], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const warm = join(dir, "warm.jar");
    execFileSync("jar", ["cf", warm, "-C", work, "NtsCdsWarm.class"], { stdio: ["ignore", "ignore", "pipe"] });
    const partial = join(dir, `nts.jsa.${process.pid}`);
    execFileSync(
      "java",
      [...FLAGS, `-XX:ArchiveClassesAtExit=${partial}`, "-cp", `${jar}:${warm}`, "NtsCdsWarm", jar],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    renameSync(partial, join(dir, "nts.jsa"));
    return dir;
  } catch (error) {
    writeFileSync(join(dir, "failed.txt"), `${error instanceof Error ? error.message : String(error)}\n`);
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * The command that runs the program `emit-jvm` wrote to `out`: `[command,
 * args]`, as a runner's `run` answers. From the archive where it exists, and
 * the plain launch otherwise.
 */
export function jvmRun(out: string): [string, string[]] {
  const jar = join(out, "nts-runtime.jar");
  const dir = archiveFor(jar);
  if (dir === null) {
    return ["java", [...FLAGS, "-Xshare:auto", "-cp", `${out}:${jar}`, ...MAIN]];
  }
  return [
    "java",
    [
      ...FLAGS,
      `-XX:SharedArchiveFile=${join(dir, "nts.jsa")}`,
      "-Xshare:auto",
      "-cp",
      `${join(dir, "nts-runtime.jar")}:${join(dir, "warm.jar")}:${out}`,
      ...MAIN,
    ],
  ];
}

/**
 * The archive is used, and changes nothing: the program run under
 * `-Xshare:on` -- which refuses to start rather than run without it -- answers
 * exactly what the plain launch answers.
 */
function selfTest(out: string): number {
  const [command, args] = jvmRun(out);
  if (!args.some((arg) => arg.startsWith("-XX:SharedArchiveFile="))) {
    console.error("launch: no archive could be made; see failed.txt under the cache directory");
    return 1;
  }
  const strict = args.map((arg) => (arg === "-Xshare:auto" ? "-Xshare:on" : arg));
  const jar = join(out, "nts-runtime.jar");
  const plain = ["-Xshare:auto", "-cp", `${out}:${jar}`];
  const run = (argv: string[]) => spawnSync(command, argv, { encoding: "utf8" });
  const archived = run(strict);
  const reference = run([...FLAGS, ...plain, ...MAIN]);
  const same =
    archived.status === reference.status &&
    archived.stdout === reference.stdout &&
    archived.stderr === reference.stderr;
  console.log(
    `launch: archived run exit ${archived.status}, plain run exit ${reference.status}; ${same ? "the same answer" : "DIFFERENT answers"}`,
  );
  if (!same) {
    console.log(`  archived: ${JSON.stringify(archived.stdout)} ${JSON.stringify(archived.stderr)}`);
    console.log(`  plain:    ${JSON.stringify(reference.stdout)} ${JSON.stringify(reference.stderr)}`);
  }
  return same ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--self-test" && argv[1]) {
    process.exit(selfTest(argv[1]));
  }
  if (argv.length !== 1) {
    console.error("usage: node tooling/jvm/launch.ts [--self-test] <emitted dir>");
    process.exit(2);
  }
  const [command, args] = jvmRun(argv[0]);
  const ran = spawnSync(command, args, { stdio: "inherit" });
  process.exit(ran.status ?? 1);
}
