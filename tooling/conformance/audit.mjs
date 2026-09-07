// Three audits that used to be run by hand, and found things every time.
//
//   node tooling/conformance/audit.mjs            # all three
//   node tooling/conformance/audit.mjs --unclaimed
//   node tooling/conformance/audit.mjs --exports
//   node tooling/conformance/audit.mjs --typecheck
//
// All three look for the same failure, the one a green sweep cannot show:
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
// The third was added after the same bug bit the checker rather than the code.
// `tsc --project runtime/node/tsconfig.json` was green while thirteen modules
// did not typecheck and `buffer` was 0 of 51, because that config references
// `web-platform` as a project and a reference resolves through built
// declarations rather than source. The declarations were an hour and three
// quarters stale. A green check over an artifact nobody rebuilt is the same
// shape as a passing test that asserts nothing.
//
// Each audit is judged against a reviewed list, in the same shape as a
// module's `not-applicable`: one `subject: reason` per line. A new entry has to
// be argued for in writing before the audit goes quiet about it, and the file
// is a record of what was considered and declined rather than a mute allowlist.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/**
 * Every module specifier a file names: `require(x)`, `from x`, and `import(x)`.
 *
 * The dynamic form matters as much as the other two here. `common/quic.mjs`
 * reaches its whole subject through `await import('node:quic')`, so a scan
 * without it reports that file as importing nothing but `fixtures`.
 */
function specifiers(text) {
  const found = new Set();
  for (const m of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) found.add(m[1]);
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) found.add(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.add(m[1]);
  return found;
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
  // Never a subject, whatever else a file imports.
  const HARNESS = new Set(["assert", "common", "test"]);
  // Of the discounted modules, the ones that can still be the subject when a
  // file imports nothing else. The split is between reaching a subject and
  // being one: `fs`, `path`, `os` and `buffer` are how a test gets at something
  // -- opens a fixture, joins a path, makes bytes -- and the 112 files this
  // promoted without the split were almost all `test-compile-cache-*`,
  // `test-debugger-*` and `test-cli-*`, which use `fs` to test something that
  // is not a module at all. A genuine `fs` test is named `test-fs-*` and its
  // pattern already claims it.
  // Discounted on our side: importing one of these does not make a file a test
  // *of* it. The list and its reasons are in `audit-incidental`, kept short and
  // argued per entry, because a wrong entry here hides a find silently.
  const neutral = new Set(readReviewed(join(HERE, "audit-incidental")).keys());
  const PROMOTABLE = new Set([...neutral].filter(
    (m) => !HARNESS.has(m) && !["fs", "path", "os", "buffer"].includes(m),
  ));

  const found = [];
  for (const file of readdirSync(PARALLEL).filter((f) => /\.(js|mjs)$/.test(f))) {
    if (patterns.some((p) => p.test(file)) || claimed.has(file)) continue;
    const own = specifiers(readFileSync(join(PARALLEL, file), "utf8"));

    // A test can reach its subject through one of node's own harness helpers,
    // and then the subject is invisible here. Every `test-quic-*` file imports
    // nothing but `assert` and `node:timers/promises` by specifier, and loads
    // `../common/quic.mjs`, which is where `await import('node:quic')` lives.
    // Twenty files read as `timers` tests on their specifiers alone. Following
    // the helper one level -- not recursively; one level is what the harness
    // actually uses -- puts `quic` back in view, and they drop out as they
    // should.
    //
    // What the helper reveals may only ever *disqualify*, never promote. The
    // first version of this added the helper's imports to the file's own set,
    // and the candidate list went from 19 to 42: `common/index.js` requires
    // `url` and `fs` as its own infrastructure, so every file that uses the
    // harness started reading as a `url` test. So the two sets are kept apart
    // -- the subject is decided by what the file itself names, and foreign
    // modules are collected from the file and its helpers together.
    const imported = new Set(own);
    for (const spec of [...own]) {
      if (!spec.startsWith("../common/") && !spec.startsWith("./common/")) continue;
      const base = join(PARALLEL, "..", spec.replace(/^\.\.\//, "").replace(/^\.\//, ""));
      // CommonJS omits the extension, so `require('../common/crypto')` names no
      // file on disk. Resolving only the exact spelling left every
      // `test-tls-*` file looking like a `util` test, because `tls` is reached
      // through `../common/crypto`. `require('../common')` names the directory,
      // whose index is already reached by its explicit spelling elsewhere; ask
      // rather than assume, since reading a directory throws EISDIR.
      const helper = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`].find(
        (c) => existsSync(c) && statSync(c).isFile(),
      );
      if (helper === undefined) continue;
      for (const s of specifiers(readFileSync(helper, "utf8"))) imported.add(s);
    }

    const bareOf = (specs) =>
      [...specs]
        .filter((r) => !r.startsWith(".") && !r.startsWith("/"))
        .map((r) => r.replace(/^node:/, "").split("/")[0]);

    const bare = bareOf(own);
    const ours = bare.filter((r) => owned.has(r) && !neutral.has(r));
    const theirs = bareOf(imported).filter((r) => !owned.has(r) && !neutral.has(r));

    // Neutrality is about *co-occurrence*, not about the module. `util`
    // alongside `net` means the file is a `net` test that formats a message.
    // `util` alone means the file is a `util` test. Discounting unconditionally
    // made `test-global-encoder.js` invisible -- it imports `assert` and `util`
    // and asserts `util.TextDecoder === TextDecoder`, which is a `util` test by
    // any reading, and no pattern claims it either.
    //
    // So when every owned import was discounted, the discounted ones are the
    // subject after all. The harness three are never a subject: `assert` is in
    // almost every file in node's suite, and `common` and `test` are the runner.
    const sole = ours.length > 0 ? [] : bare.filter((r) => owned.has(r) && PROMOTABLE.has(r));

    if (theirs.length === 0 && (ours.length > 0 || sole.length > 0)) {
      found.push({ file, modules: [...new Set(ours.length > 0 ? ours : sole)].sort() });
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

/**
 * Every module typechecked against **its own** tsconfig.
 *
 * The aggregate `runtime/node/tsconfig.json` cannot do this job, and the reason
 * is worth the paragraph. It carries `"references": [{ "path":
 * "../web-platform" }]`, and a project reference resolves through the
 * referenced project's *built declarations* rather than its source. When
 * `web-platform` dropped `utf8Decode` from `src/core/utf8.ts`, the declaration
 * file in its `.tsbuild/dist` still declared it -- built 18:09, source edited
 * 19:51 -- so the aggregate typecheck read a stale artifact and reported green
 * while thirteen modules were broken and `buffer` was 0 of 51.
 *
 * A per-module config has no reference and resolves `web-platform` through
 * source, so it fails immediately. That is the whole difference, and it is why
 * this runs 22 typechecks rather than one.
 */
async function typecheckFailures(modules) {
  const limit = 8;
  const found = [];
  const queue = [...modules];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let m = queue.shift(); m !== undefined; m = queue.shift()) {
      const run = spawnSync(
        "pnpm",
        ["exec", "tsc", "--project", join(PROFILE, m, "tsconfig.json"), "--pretty", "false"],
        { encoding: "utf8", cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
      );
      const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
      if (out !== "") found.push({ module: m, first: out.split("\n")[0] });
    }
  });
  await Promise.all(workers);
  return found.sort((a, b) => a.module.localeCompare(b.module));
}

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

if (wants("typecheck")) {
  const found = await typecheckFailures(modules);
  console.log(
    `typecheck: ${modules.length - found.length} of ${modules.length} module(s) ` +
      `typecheck against their own tsconfig`,
  );
  for (const f of found) console.log(`  ${f.module}: ${f.first}`);
  if (found.length > 0) {
    console.log(
      "\nThe aggregate `runtime/node/tsconfig.json` may still be green: it references\n" +
        "`web-platform` as a project, so it reads that project's built declarations\n" +
        "rather than its source. Per-module configs read source. Believe these.",
    );
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
