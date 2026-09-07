import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PINNED_REVISION = "8a1406e7d14bfcb6c046021f13cc15cfb162726d";
const implementations = [
  "go-hpack",
  "haskell-http2-linear",
  "haskell-http2-linear-huffman",
  "haskell-http2-naive",
  "haskell-http2-naive-huffman",
  "haskell-http2-static",
  "haskell-http2-static-huffman",
  "nghttp2",
  "nghttp2-16384-4096",
  "nghttp2-change-table-size",
  "node-http2-hpack",
  "python-hpack",
  "swift-nio-hpack-huffman",
  "swift-nio-hpack-plain-text",
];

const corpusArgument = process.argv[2] ?? process.env.NTS_HPACK_TEST_CASE_ROOT;
if (corpusArgument === undefined) {
  console.error(
    "usage: node tooling/conformance/web-platform/test-hpack-upstream.mjs <hpack-test-case checkout>",
  );
  process.exit(2);
}
const corpusRoot = resolve(corpusArgument);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function git(...args) {
  const result = spawnSync("git", ["-C", corpusRoot, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

assert.equal(git("rev-parse", "HEAD"), PINNED_REVISION, "HPACK corpus revision changed");
assert.equal(git("status", "--porcelain"), "", "HPACK corpus checkout is dirty");

if (process.env.NTS_WEB_PLATFORM_COMPILED !== "1") {
  const build = spawnSync(
    "pnpm",
    [
      "exec",
      "tsc",
      "--project",
      "tooling/conformance/web-platform/tsconfig.json",
      "--pretty",
      "false",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const { HpackDecoder } =
  await import("./node_modules/.tsbuild/host/runtime/web-platform/src/http2/hpack.js");

let total = 0;
for (const implementation of implementations) {
  const directory = resolve(corpusRoot, implementation);
  const stories = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();

  for (const storyName of stories) {
    const story = JSON.parse(readFileSync(resolve(directory, storyName), "utf8"));
    const initialSize =
      typeof story.cases[0]?.header_table_size === "number"
        ? story.cases[0].header_table_size
        : 4096;
    const decoder = new HpackDecoder(initialSize, {
      maxHeaderListBytes: 0x7fffffff,
      maxStringBytes: 0x7fffffff,
    });

    for (const fixture of story.cases) {
      if (typeof fixture.header_table_size === "number") {
        decoder.setMaximumTableSize(fixture.header_table_size);
      }
      const block = Uint8Array.from(Buffer.from(fixture.wire, "hex"));
      const actual = decoder.decode(block).map((field) => ({ [field.name]: field.value }));
      assert.deepEqual(
        actual,
        fixture.headers,
        `${implementation}/${storyName} case ${fixture.seqno}`,
      );
      total++;
    }
  }
}

console.log(
  `HPACK upstream corpus: ${total}/${total} cases across ${implementations.length} encoders`,
);
