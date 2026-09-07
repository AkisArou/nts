// Two audits that used to be run by hand, and found things every time.
//
//   node tooling/conformance/audit.mjs            # both
//   node tooling/conformance/audit.mjs --unclaimed
//   node tooling/conformance/audit.mjs --exports
//
// Both look for the same failure, which is the one a green sweep cannot show:
// something that is *absent* rather than wrong. A test file no module claims
// is not a failure and not a skip -- it is in no denominator on either axis,
// so every percentage in the ledger is computed without it. An export node has
// and we do not is invisible for the same reason: no test can fail on a
// function nothing calls.
//
// Six separate finds came out of the first one by hand -- about forty
// applicable tests, including ten of `fs`'s own while it reported 328 of 328.
// The second found `url.fileURLToPathBuffer` and `util.aborted`, each with a
// pinned test that no pattern was claiming. Running them by hand means finding
// them when somebody remembers to look, which is why they are here.
//
// Each audit is judged against a reviewed list, in the same shape as a
// module's `not-applicable`: one `subject: reason` per line. A new entry has to
// be argued for in writing before the audit goes quiet about it, and the file
// is a record of what was considered and declined rather than a mute allowlist.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const PROFILE = join(ROOT, "runtime/node");
const PARALLEL = join(ROOT, "third_party/node/test/parallel");

const argv = process.argv.slice(2);
const only = argv.filter((a) => a.startsWith("--")).map((a) => a.slice(2));
const wants = (name) => only.length === 0 || only.includes(name);

/** Modules in the profile: a directory with a tsconfig is the definition. */
function profileModules() {
  return readdirSync(PROFILE, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PROFILE, e.name, "tsconfig.json")))
    .map((e) => e.name)
    .sort();
}

/** `subject: reason` lines, as `not-applicable` uses. */
function readReviewed(path) {
  const reviewed = new Map();
  if (!existsSync(path)) return reviewed;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const text = line.trim();
    if (text === "" || text.startsWith("#")) continue;
    const split = text.indexOf(": ");
    if (split < 0) throw new Error(`${path}: every line needs a reason: ${text}`);
    reviewed.set(text.slice(0, split), text.slice(split + 2));
  }
  return reviewed;
}

// ---------------------------------------------------------------------------

/**
 * Test files that belong to a module in this profile and that no module claims.
 *
 * The filter is what makes this reviewable rather than a list of two thousand.
 * A file counts as ours when it imports at least one module we implement, and
 * imports *nothing* we do not -- so a `tls` test that happens to use `util` is
 * excluded by its `tls` import, and only `assert` is discounted on our side,
 * because almost every test in node's suite uses it and it decides nothing.
 *
 * The filenames are deliberately not consulted. Every instance of this bug was
 * a file whose name did not look like its module: `test-stdin-*` for `process`,
 * `test-blocklist-*` for `net`, `test-als-*` for `async_hooks`,
 * `test-diagnostic-channel-*` with `diagnostic` singular. A name-shaped rule
 * would have found none of them.
 */
function unclaimed(modules) {
  const patterns = modules.map((m) => {
    const own = join(PROFILE, m, "test-pattern");
    return existsSync(own)
      ? new RegExp(readFileSync(own, "utf8").trim())
      : new RegExp(`^test-${m}(-.*)?\\.m?js$`);
  });

  const claimed = new Set();
  for (const m of modules) {
    for (const list of ["extra-tests", "test-suites"]) {
      const path = join(PROFILE, m, list);
      if (!existsSync(path)) continue;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const text = line.trim();
        if (text === "" || text.startsWith("#")) continue;
        claimed.add(text.split(/[:\s]/)[0].replace(/^parallel\//, ""));
      }
    }
  }

  const owned = new Set(modules);
  // Discounted on our side: importing one of these does not make a file a test
  // *of* it. The list and its reasons are in `audit-incidental`, kept short and
  // argued per entry, because a wrong entry here hides a find silently.
  const neutral = new Set(readReviewed(join(HERE, "audit-incidental")).keys());

  const found = [];
  for (const file of readdirSync(PARALLEL).filter((f) => /\.(js|mjs)$/.test(f))) {
    if (patterns.some((p) => p.test(file)) || claimed.has(file)) continue;
    const text = readFileSync(join(PARALLEL, file), "utf8");
    const imported = new Set();
    for (const m of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) imported.add(m[1]);
    for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) imported.add(m[1]);
    const bare = [...imported]
      .filter((r) => !r.startsWith(".") && !r.startsWith("/"))
      .map((r) => r.replace(/^node:/, "").split("/")[0]);
    const ours = bare.filter((r) => owned.has(r) && !neutral.has(r));
    const theirs = bare.filter((r) => !owned.has(r) && !neutral.has(r));
    if (ours.length > 0 && theirs.length === 0) {
      found.push({ file, modules: [...new Set(ours)].sort() });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------

/**
 * Exports node has that the substituted module does not.
 *
 * Read through the substitution rather than from the source, because what a
 * program can reach is the shape a module's `shape.mjs` assembles. Own
 * enumerable keys only would be wrong on its own -- `process.exitCode`,
 * `title` and `ppid` are inherited accessors and came back as false positives
 * the first time -- so each candidate is re-checked with `in` before it counts.
 */
function missingExports(modules) {
  const probe = join(HERE, "audit-keys.cjs");
  const found = [];
  for (const module of modules) {
    const ask = (names) => {
      const run = spawnSync(
        process.execPath,
        [join(HERE, "run-one.mjs"), module, probe, "-"],
        {
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          env: {
            ...process.env,
            NTS_AUDIT_MODULE: module,
            NTS_AUDIT_NAMES: names === undefined ? "" : JSON.stringify(names),
          },
        },
      );
      return `${run.stdout ?? ""}`.split("\n");
    };

    const first = ask(undefined);
    const keys = first.find((l) => l.startsWith("NTSKEYS "));
    if (keys === undefined) {
      throw new Error(`could not read the export surface of ${module}`);
    }
    const ours = new Set(JSON.parse(keys.slice("NTSKEYS ".length)));

    let real;
    try {
      real = createRequireOf(module);
    } catch {
      continue;
    }
    const suspected = Object.keys(real).filter((k) => !k.startsWith("_") && !ours.has(k));
    if (suspected.length === 0) continue;

    // Second pass: own enumerable keys are not the whole surface, so anything
    // the first pass suspects is re-asked with `in` before it counts.
    const answer = ask(suspected).find((l) => l.startsWith("NTSREACHABLE "));
    const reachable = new Set(
      answer === undefined ? [] : JSON.parse(answer.slice("NTSREACHABLE ".length)),
    );
    for (const key of suspected) {
      if (!reachable.has(key)) found.push({ module, key });
    }
  }
  return found;
}

function createRequireOf(module) {
  // This audit requires every module in the profile, and some of node's are
  // deprecated -- `punycode` prints a DeprecationWarning on load. That warning
  // is true and useless here, and it would appear in the output of every sweep,
  // so it is silenced for the load and restored immediately.
  const previous = process.noDeprecation;
  process.noDeprecation = true;
  try {
    // `node:` prefixed so a shadowing file in the tree cannot answer instead.
    return require(`node:${module}`);
  } finally {
    process.noDeprecation = previous;
  }
}

// A CommonJS `require` inside an ES module, for the host's own modules only.
const require = (await import("node:module")).createRequire(import.meta.url);

// ---------------------------------------------------------------------------

const modules = profileModules();
let failed = false;

if (wants("unclaimed")) {
  const reviewed = readReviewed(join(HERE, "unclaimed-reviewed"));
  const found = unclaimed(modules);
  const news = found.filter((f) => !reviewed.has(f.file));
  console.log(
    `unclaimed tests: ${found.length} candidate(s), ${reviewed.size} reviewed, ${news.length} new`,
  );
  for (const f of news) {
    console.log(`  ${f.file}  (imports ${f.modules.join(", ")})`);
  }
  if (news.length > 0) {
    console.log(
      "\nEach of these imports a module this profile implements and nothing it does not,\n" +
        "and no module's test-pattern or extra-tests claims it. Claim it, or add a line to\n" +
        "tooling/conformance/unclaimed-reviewed saying why it is not ours.",
    );
    failed = true;
  }
}

if (wants("exports")) {
  const reviewed = readReviewed(join(HERE, "missing-exports"));
  const found = missingExports(modules);
  const news = found.filter((f) => !reviewed.has(`${f.module}.${f.key}`));
  console.log(
    `missing exports: ${found.length} absent from the shape, ${reviewed.size} reviewed, ${news.length} new`,
  );
  for (const f of news) console.log(`  ${f.module}.${f.key}`);
  if (news.length > 0) {
    console.log(
      "\nNode exports these and the substituted module does not, so no test can reach them.\n" +
        "Implement it, or add a line to tooling/conformance/missing-exports saying why not.",
    );
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
