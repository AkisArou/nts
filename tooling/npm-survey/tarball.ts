// Reading a published archive as data.
//
// Shared by `classify.ts` and `vendor.ts` so the two cannot disagree about what
// a package contains — they answer different questions about the same bytes,
// and a survey whose classifier and extractor parse tarballs differently is
// measuring two ecosystems.
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve, posix } from "node:path";

/** Package-relative path -> file contents. */
export type Archive = Map<string, Buffer>;

/**
 * A ustar reader, enough for what npm publishes.
 *
 * The leading `package/` component every npm tarball carries is stripped, so
 * keys read the way `package.json` writes them.
 */
export function untar(buf: Buffer): Archive {
  const files: Archive = new Map();
  let off = 0;
  let longName: string | null = null;

  while (off + 512 <= buf.length) {
    const head = buf.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;
    const str = (at: number, n: number) =>
      head.subarray(at, at + n).toString("latin1").replace(/\0.*$/, "").trim();

    let name = longName ?? str(0, 100);
    const prefix = str(345, 155);
    if (prefix && !longName) name = prefix + "/" + name;
    longName = null;

    const size = Number.parseInt(str(124, 12) || "0", 8) || 0;
    const type = String.fromCharCode(head[156]!);
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;

    // GNU long-name entry: the next header's name, carried in a body.
    if (type === "L") {
      longName = body.toString("latin1").replace(/\0.*$/, "");
      continue;
    }
    if (type === "0" || type === "\0") files.set(name.replace(/^[^/]+\//, ""), body);
  }
  return files;
}

export async function readArchive(path: string): Promise<Archive> {
  return untar(gunzipSync(await readFile(path)));
}

export interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  module?: string;
  browser?: unknown;
  bin?: unknown;
  types?: string;
  typings?: string;
  exports?: unknown;
  repository?: string | { url?: string; directory?: string };
  gitHead?: string;
}

export const readPackageJson = (files: Archive): PackageJson =>
  files.has("package.json")
    ? (JSON.parse(files.get("package.json")!.toString("utf8")) as PackageJson)
    : {};

export const norm = (p: string): string => p.replace(/^\.\//, "").replace(/\/+/g, "/");

const DECL = /\.d\.(m|c)?ts$/;
const TS = /\.(m|c)?tsx?$/;
const JS = /\.(m|c)?js$/;

export const isDeclaration = (p: string): boolean => DECL.test(p);
export const isJavaScript = (p: string): boolean => JS.test(p);

/**
 * A `.ts` file that is somebody's implementation.
 *
 * Excludes declarations, `tsd` type-test files and test directories. The
 * exclusion is not fussiness: a first pass counted 48 packages as shipping
 * TypeScript and most of them were shipping `index.test-d.ts` and no
 * implementation at all. `rfdc` "ships TypeScript": 273 bytes of type
 * assertions.
 */
export const isImplementationTs = (p: string): boolean =>
  TS.test(p) &&
  !DECL.test(p) &&
  !/\.(test-d|test\.d|spec-d)\.(m|c)?ts$/.test(p) &&
  !/(^|\/)(test|tests|__tests__|spec)\//.test(p);

/** Every file `exports`, `main`, `module`, `browser` or `bin` can name. */
export function entryTargets(pkg: PackageJson): string[] {
  const out = new Set<string>();
  const eat = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.startsWith("./")) out.add(norm(v));
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(eat);
      return;
    }
    if (v && typeof v === "object") Object.values(v).forEach(eat);
  };
  if (pkg.exports !== undefined) eat(pkg.exports);
  for (const key of ["main", "module"] as const) {
    const v = pkg[key];
    if (typeof v === "string") out.add(norm(v));
  }
  if (pkg.bin && typeof pkg.bin === "object") {
    for (const v of Object.values(pkg.bin)) if (typeof v === "string") out.add(norm(v));
  } else if (typeof pkg.bin === "string") out.add(norm(pkg.bin));
  if (!out.size) out.add("index.js");
  return [...out];
}

export interface SourceMap {
  sources: string[];
  /** Parallel to `sources`; `null` where the map declined to embed the text. */
  content: (string | null)[];
}

/** Flatten a source map, following `sections` for an index map. */
export function readMap(text: string): SourceMap | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const acc: SourceMap = { sources: [], content: [] };
  const walk = (m: Record<string, unknown>): void => {
    const sections = m["sections"];
    if (Array.isArray(sections)) {
      for (const s of sections) {
        const inner = (s as Record<string, unknown>)["map"];
        if (inner) walk(inner as Record<string, unknown>);
      }
      return;
    }
    const sources = (m["sources"] as string[] | undefined) ?? [];
    const content = (m["sourcesContent"] as (string | null)[] | undefined) ?? [];
    sources.forEach((s, i) => {
      acc.sources.push(s);
      acc.content.push(content[i] ?? null);
    });
  };
  walk(parsed as Record<string, unknown>);
  return acc;
}

/** The map for a generated file: a sibling `.map`, or an inline data URL. */
export function mapFor(files: Archive, jsPath: string): SourceMap | null {
  const sibling = files.get(jsPath + ".map");
  if (sibling) {
    const m = readMap(sibling.toString("utf8"));
    if (m) return m;
  }
  const body = files.get(jsPath);
  if (!body) return null;
  const inline = /sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([A-Za-z0-9+/=]+)/.exec(
    body.toString("utf8"),
  );
  return inline ? readMap(Buffer.from(inline[1]!, "base64").toString("utf8")) : null;
}

/**
 * Join a map-declared source path onto an extraction root, or refuse.
 *
 * Map `sources` are attacker-adjacent and routinely escape their package
 * anyway: `tar`'s own map names paths under a bundled `node_modules`. Leading
 * `../` is stripped rather than honoured, and anything that still lands outside
 * the root is refused rather than clamped.
 */
export function safeJoin(root: string, rel: string): string | null {
  const clean = posix.normalize(rel.replace(/^(\.\.\/)+/, "").replace(/^\/+/, ""));
  const full = resolve(root, clean);
  return full.startsWith(resolve(root)) ? full : null;
}
