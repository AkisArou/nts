// The Journal's twin under node: the libadwaita Journal as the React stage
// rewrites it (native/journal/src/AdwJournal.tsx), played on the probe's
// typed test host by native/journal/twin's session, whose log must equal
// native/journal/twin/expected.log. That log is what the native Journal must
// print once it renders on libadwaita.
//
// Only the staged component runs: its host components are lowered to host
// type strings, where the file as written names react-gtk's declared
// constants, which exist only in a native build.
//
// usage: node tools/journal-twin.ts [--update]
//   NTS_REACT names the nts-react binary (default: the lane's debug build),
//   NTS_TSGO the tsgo it drives. --update writes the log as expected.log.

import { build, type Plugin } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const lane = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const journal = join(lane, "native/journal");
const twin = join(journal, "twin");
const expectedLog = join(twin, "expected.log");
const ntsReact = process.env.NTS_REACT ?? join(process.env.HOME ?? "", ".cache/nts-react/target/debug/nts-react");

const work = mkdtempSync(join(tmpdir(), "journal-twin-"));
try {
  const staged = join(work, "staged");
  execFileSync(ntsReact, ["stage", join(journal, "tsconfig.json"), staged], { stdio: ["ignore", "ignore", "inherit"] });
  const component = readFileSync(join(staged, "AdwJournal.tsx"), "utf8");
  // The stage ran: the component memoizes, and names no host component by
  // its declared constant.
  if (!/\b_cacheOf\(|\b_c\(/.test(component)) throw new Error("the staged AdwJournal.tsx memoizes nothing: the compiler did not run");
  if (/_jsxs?\([A-Z]/.test(component)) throw new Error("the staged AdwJournal.tsx still names a host component by its constant");

  const substitute: Plugin = {
    name: "staged",
    setup(on) {
      on.onLoad({ filter: /AdwJournal\.tsx$/ }, (args) =>
        args.path === join(journal, "src/AdwJournal.tsx") ? { contents: component, loader: "tsx" } : undefined,
      );
    },
  };
  // The session, handed the staged component.
  const entry = join(work, "entry.ts");
  writeFileSync(
    entry,
    `import { AdwJournal } from ${JSON.stringify(join(journal, "src/AdwJournal.tsx"))};\n` +
      `import { playSession } from ${JSON.stringify(join(twin, "src/session.ts"))};\n` +
      `playSession(AdwJournal);\n`,
  );
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    tsconfig: join(twin, "tsconfig.json"),
    jsx: "automatic",
    plugins: [substitute],
    logLevel: "error",
  });
  const bundle = join(work, "twin.mjs");
  writeFileSync(bundle, result.outputFiles[0]!.contents);
  const log = execFileSync(process.execPath, [bundle], { encoding: "utf8" });

  if (process.argv.includes("--update")) {
    writeFileSync(expectedLog, log);
    console.log(`wrote ${expectedLog}`);
  } else {
    const expected = readFileSync(expectedLog, "utf8");
    if (log !== expected) {
      console.log(`the twin's log differs from expected.log:\n--- expected\n${expected}--- got\n${log}`);
      process.exitCode = 1;
    } else {
      console.log(`the Journal's twin logs expected.log (${log.trim().split("\n").length} steps)`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
