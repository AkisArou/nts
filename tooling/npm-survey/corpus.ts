// Build one real project out of the survey's closure, so acquisition can be
// measured the way it is actually used: per project, driven by what the program
// imports, rather than package by package out of a tarball.
//
//   node corpus.ts <out-dir>
//
// Installs every package in `closure.json` flat into `node_modules`, the way a
// hoisting package manager would, and writes a program that imports each root.
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { readArchive } from "./tarball.ts";
import type { Resolved } from "./resolve.ts";

const HERE = new URL("./", import.meta.url).pathname;
const out = process.argv[2];
if (!out) throw new Error("usage: node corpus.ts <out-dir>");

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/src`, { recursive: true });

const closure = JSON.parse(await readFile(HERE + "closure.json", "utf8")) as Resolved[];
const roots = JSON.parse(await readFile(HERE + "roots.json", "utf8")) as string[];

// Flat install. A real hoist would nest the conflicting versions; the closure
// has one version per name by construction, so flat is exact here.
let installed = 0;
for (const pkg of closure) {
  const tar = `${HERE}tars/${pkg.name.replace(/[@/]/g, "_")}-${pkg.version}.tgz`;
  let files;
  try {
    files = await readArchive(tar);
  } catch {
    continue;
  }
  for (const [at, body] of files) {
    const dest = `${out}/node_modules/${pkg.name}/${at}`;
    if (dest.includes("/../")) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body);
  }
  installed++;
}

const identifier = (name: string) => "m" + name.replace(/[^A-Za-z0-9]/g, "_");
await writeFile(
  `${out}/src/main.ts`,
  "// Imports every root, so acquisition is measured against what a program\n" +
    "// uses rather than what a manifest offers.\n" +
    roots.map((name) => `import * as ${identifier(name)} from "${name}";`).join("\n") +
    "\n\nexport const used = [\n" +
    roots.map((name) => `  ${identifier(name)},`).join("\n") +
    "\n];\n",
);
await writeFile(
  `${out}/package.json`,
  JSON.stringify(
    {
      name: "npm-corpus",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(
        closure.filter((p) => p.depth === 0).map((p) => [p.name, p.version]),
      ),
    },
    null,
    1,
  ),
);
await writeFile(
  `${out}/tsconfig.json`,
  JSON.stringify(
    {
      compilerOptions: {
        lib: ["ESNext"],
        module: "preserve",
        target: "esnext",
        moduleResolution: "bundler",
        moduleDetection: "force",
        allowImportingTsExtensions: true,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        disableSizeLimit: true,
        types: [],
      },
      include: ["src/**/*"],
    },
    null,
    1,
  ),
);

console.log(`installed ${installed} of ${closure.length} packages into ${out}`);
console.log(`program imports ${roots.length} roots`);
