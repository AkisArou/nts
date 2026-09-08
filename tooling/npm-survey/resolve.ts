// Resolve the runtime dependency closure of a set of roots, straight from the
// registry. No npm, no install, no lifecycle scripts: this reads metadata.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

type Version = [major: number, minor: number, patch: number];

interface PackumentVersion {
  dependencies?: Record<string, string>;
  dist?: { tarball?: string };
}

interface Packument {
  versions: Record<string, PackumentVersion>;
}

export interface Resolved {
  name: string;
  version: string;
  tarball: string | undefined;
  deps: Record<string, string>;
  depth: number;
}

const CACHE = new URL("./meta/", import.meta.url).pathname;
await mkdir(CACHE, { recursive: true });

const parse = (v: string): Version => {
  const [major = 0, minor = 0, patch = 0] = v.split("-")[0]!.split(".").map(Number);
  return [major, minor, patch];
};
const cmp = (a: Version, b: Version): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Pick a plausible member of a range.
 *
 * Deliberately crude, and it does not need to be anything else: the survey asks
 * what a package's *published files* look like, and that does not turn on
 * picking the same version npm's solver would.
 */
function semverMax(versions: string[], range: string): string | undefined {
  const stable = versions.filter((v) => !v.includes("-"));
  const pool = stable.length ? stable : versions;
  if (!range || range === "*" || range === "latest" || range.startsWith("workspace:")) {
    return pool.at(-1);
  }
  const m = /^([\^~>=]*)\s*v?(\d+)\.(\d+)\.(\d+)/.exec(range);
  if (!m) return pool.at(-1);
  const op = m[1]!;
  const base: Version = [Number(m[2]), Number(m[3]), Number(m[4])];
  const ok = pool.filter((v) => {
    const p = parse(v);
    if (cmp(p, base) < 0) return false;
    // A caret on 0.x pins the minor, which is the only part of this worth
    // getting right: 0.x packages are a large slice of the ecosystem.
    if (op.includes("^")) return base[0] === 0 ? p[0] === 0 && p[1] === base[1] : p[0] === base[0];
    if (op.includes("~")) return p[0] === base[0] && p[1] === base[1];
    if (op.includes(">")) return true;
    return cmp(p, base) === 0;
  });
  return (ok.length ? ok : pool).at(-1);
}

async function packument(name: string): Promise<Packument> {
  const file = CACHE + encodeURIComponent(name) + ".json";
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8")) as Packument;
  const res = await fetch(`https://registry.npmjs.org/${name}`, {
    // The abbreviated document: versions, dependencies and dist, without the
    // README and the full history, which is most of the bytes.
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const body = (await res.json()) as Packument;
  await writeFile(file, JSON.stringify(body));
  return body;
}

const roots = JSON.parse(process.argv[2] ?? "[]") as string[];
const seen = new Map<string, Resolved>();
const depth = new Map<string, number>();
const failed: string[] = [];
const queue: { spec: string; d: number }[] = roots.map((spec) => ({ spec, d: 0 }));

while (queue.length) {
  const { spec, d } = queue.shift()!;
  // A scope makes the last `@` the version separator, not the first.
  const at = spec.lastIndexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  const range = at > 0 ? spec.slice(at + 1) : "";

  let doc: Packument;
  try {
    doc = await packument(name);
  } catch (e) {
    failed.push(`${name}: ${(e as Error).message}`);
    continue;
  }

  const version = semverMax(Object.keys(doc.versions), range);
  if (!version) {
    failed.push(`${name}: no version for ${range}`);
    continue;
  }
  const key = `${name}@${version}`;
  if (seen.has(key)) {
    depth.set(key, Math.min(depth.get(key)!, d));
    continue;
  }
  const v = doc.versions[version]!;
  const deps = v.dependencies ?? {};
  seen.set(key, { name, version, tarball: v.dist?.tarball, deps, depth: d });
  depth.set(key, d);
  for (const [dn, dr] of Object.entries(deps)) queue.push({ spec: `${dn}@${dr}`, d: d + 1 });
}

const out = [...seen.entries()].map(([key, r]) => ({ ...r, depth: depth.get(key)! }));
await writeFile(new URL("./closure.json", import.meta.url), JSON.stringify(out, null, 1));
console.error(`resolved ${out.length} packages, ${failed.length} failures`);
for (const f of failed.slice(0, 10)) console.error("  " + f);
