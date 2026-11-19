// A commit's source digest for one binary: the same digest the binary's build
// script embeds from the files on disk (tooling/cli/source_identity.rs, which
// states the format), computed here from the commit's own blobs. Equal digests
// mean the binary was built from exactly that commit's sources under its
// roots (tooling/cli/source-roots.txt), whatever HEAD said at build time.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gitArguments } from "../gate/git-arguments/main.ts";
import { fileInput } from "../gate/reader-inputs/main.ts";
import { ToolingInstrumentError } from "../gate/step-result.ts";

export const SOURCE_ROOTS = fileInput(new URL("../cli/source-roots.txt", import.meta.url));
export type SourceBinary = "nts" | "nts-bench";

/** The roots one binary's digest covers, from the one list both build scripts read. */
export function sourceRoots(binary: SourceBinary, text = readFileSync(fileURLToPath(SOURCE_ROOTS), "utf8")): string[] {
  const line = text.split("\n").find((entry) => entry.startsWith(binary + ":"));
  if (!line) throw new ToolingInstrumentError("tooling-setup", `tooling/cli/source-roots.txt names no roots for ${binary}`);
  return line.slice(binary.length + 1).trim().split(/\s+/);
}

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The digest of (path, content) pairs, in byte order of path, as source_identity.rs hashes them. */
export function digestOf(files: readonly { path: string; content: Uint8Array }[]): string {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const digest = createHash("sha256").update("nts-source-v1\n");
  for (const { path, content } of sorted) digest.update(path).update("\0").update(sha256(content)).update("\n");
  return digest.digest("hex");
}

/** `binary`'s source digest at `commit`, from the commit's blobs under its roots. */
export function sourceDigest(root: string, commit: string, binary: SourceBinary): string {
  const roots = sourceRoots(binary);
  const listing = execFileSync("git", gitArguments(["ls-tree", "-r", "-z", "--full-tree", commit, "--", ...roots]), { cwd: root, maxBuffer: 1 << 28 }).toString("utf8");
  const entries = listing.split("\0").filter(Boolean).map((line) => {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(line);
    if (!match) throw new ToolingInstrumentError("tooling-setup", `unreadable tree entry at ${commit}: ${line}`);
    return { type: match[2]!, oid: match[3]!, path: match[4]! };
  }).filter((entry) => entry.type === "blob");
  if (!entries.length) throw new ToolingInstrumentError("tooling-setup", `no sources under ${binary}'s roots at ${commit}`);
  const batch = execFileSync("git", gitArguments(["cat-file", "--batch"]), { cwd: root, input: entries.map((entry) => entry.oid).join("\n") + "\n", maxBuffer: 1 << 30 });
  const files: { path: string; content: Uint8Array }[] = [];
  let at = 0;
  for (const entry of entries) {
    const newline = batch.indexOf(10, at);
    const header = batch.subarray(at, newline).toString("utf8").split(" ");
    if (header[0] !== entry.oid || header[1] !== "blob") throw new ToolingInstrumentError("tooling-setup", `unexpected blob for ${entry.path}: ${header.join(" ")}`);
    const size = Number(header[2]);
    files.push({ path: entry.path, content: batch.subarray(newline + 1, newline + 1 + size) });
    at = newline + 1 + size + 1;
  }
  return digestOf(files);
}

/** The digest a binary names, checked against the measured commit's. */
export function requireSourceDigest(root: string, commit: string, binary: SourceBinary, named: string, what: string): void {
  const expected = sourceDigest(root, commit, binary);
  if (named !== expected)
    throw new ToolingInstrumentError("tooling-setup",
      `${what} was not built from ${commit.slice(0, 12)}'s sources (digest ${named.slice(0, 12)}, expected ${expected.slice(0, 12)}); commit and rebuild with cargo build --release`);
}
