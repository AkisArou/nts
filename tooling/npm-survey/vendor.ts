// Recover each package's implementation out of what npm shipped, and lay it out
// as ordinary source.
//
// Ordinary is the operative word. `compiled_files` in the frontend drops
// anything TypeScript resolved out of `node_modules`, whatever route resolved
// it, and admits the identical bytes sitting anywhere else — so recovery's
// whole job is to put the source somewhere the compiler already looks.
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  readArchive,
  readPackageJson,
  entryTargets,
  mapFor,
  isImplementationTs,
  isJavaScript,
  isDeclaration,
  safeJoin,
} from "./tarball.ts";
import type { Resolved } from "./resolve.ts";
import type { Classified } from "./classify.ts";

const HERE = new URL("./", import.meta.url).pathname;
const OUT = HERE + "vendored/";

export interface Vendored {
  name: string;
  version: string;
  root: string;
  /** The recovered file the package's entry point resolves to, if one was found. */
  entry: string | null;
  files: number;
  deps: string[];
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const classified = JSON.parse(await readFile(HERE + "classified.json", "utf8")) as Classified[];
const closure = JSON.parse(await readFile(HERE + "closure.json", "utf8")) as Resolved[];
const wanted = classified.filter((x) => x.route === "entry-ts" || x.route === "entry-map-ts");
const report: Vendored[] = [];

for (const rec of wanted) {
  const resolved = closure.find((c) => c.name === rec.name && c.version === rec.version);
  const files = await readArchive(
    HERE + "tars/" + rec.name.replace(/[@/]/g, "_") + "-" + rec.version + ".tgz",
  );
  const pkg = readPackageJson(files);
  const root = OUT + rec.name.replace(/[@/]/g, "_");

  /** Absolute destination -> contents. One logical path, one content. */
  const written = new Map<string, Buffer | string>();
  let entry: string | null = null;

  for (const target of entryTargets(pkg)) {
    // A `types` condition names a `.d.ts`, which is a contract and not an
    // implementation. Taking it as an entry is how an earlier pass reported
    // `entry=dist/esm/index.d.ts` for half the sample.
    if (isImplementationTs(target) && !isDeclaration(target) && files.has(target)) {
      const dest = safeJoin(root, target);
      if (dest) {
        written.set(dest, files.get(target)!);
        entry ??= dest;
      }
      continue;
    }
    if (!isJavaScript(target) || !files.has(target)) continue;

    const map = mapFor(files, target);
    if (!map) continue;
    let firstForEntry: string | null = null;
    map.sources.forEach((source, i) => {
      const body = map.content[i];
      if (body == null || !/\.(m|c)?tsx?$/.test(source) || isDeclaration(source)) return;
      const dest = safeJoin(root, source);
      if (!dest) return;
      const prior = written.get(dest);
      if (prior !== undefined && prior.toString() !== body) return; // conflicting contents
      written.set(dest, body);
      firstForEntry ??= dest;
    });
    entry ??= firstForEntry;
  }

  for (const [dest, body] of written) {
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body);
  }

  report.push({
    name: rec.name,
    version: rec.version,
    root,
    entry,
    files: written.size,
    deps: Object.keys(resolved?.deps ?? {}),
  });
}

await writeFile(HERE + "vendored.json", JSON.stringify(report, null, 1));
console.log(`vendored ${report.length} packages`);
for (const r of report) {
  const where = r.entry ? r.entry.slice(r.root.length + 1) : "NONE";
  console.log(`  ${r.name.padEnd(26)} files=${String(r.files).padStart(4)} entry=${where}`);
}
