// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
// `file:` is a capability-scoped provider extension: absent by default, and when
// present it is the provider that decides which files exist and which may be read.
// The shared layer owns which URLs are fetchable at all and the shape of the response.
//
// Host evidence for the shared algorithm and for one provider's scoping. A different
// provider's scoping is its own to prove.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createHostNodeWebPlatform,
  HostNodeFileURLProvider,
} from "../node-runtime.ts";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);

// Fetch reports every failure as an opaque `TypeError: Network request failed`, so the
// reason lives on the cause chain. That is the specified behaviour and it is also why
// a refused path never puts a filesystem detail into the message script sees.
function because(pattern) {
  return (error) => {
    assert.equal(error.name, "TypeError");
    assert.equal(error.message, "Network request failed");
    let cause = error.cause;
    let text = "";
    while (cause !== undefined && cause !== null) {
      text += String(cause.message ?? cause) + " ";
      cause = cause.cause;
    }
    assert.match(text, pattern);
    return true;
  };
}

function tree(t) {
  const dir = mkdtempSync(join(tmpdir(), "nts-file-url-"));
  const root = join(dir, "root");
  mkdirSync(root);
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "hello.txt"), "hello from a file");
  writeFileSync(join(root, "nested", "deep.json"), '{"ok":true}');
  writeFileSync(join(dir, "secret.txt"), "outside the root");
  symlinkSync(join(dir, "secret.txt"), join(root, "escape.txt"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, root };
}

function runtimeWith(t, root) {
  const api = createHostNodeWebPlatform({
    fileURLs:
      root === null
        ? undefined
        : new HostNodeFileURLProvider({
            root,
            types: { ".txt": "text/plain;charset=UTF-8", ".json": "application/json" },
          }),
  });
  t.after(() => api.close());
  return api;
}

suite("file: is unsupported until a provider is supplied", async (t) => {
  const { root } = tree(t);
  const api = runtimeWith(t, null);
  const url = pathToFileURL(join(root, "hello.txt")).href;
  await assert.rejects(api.fetch(url), because(/Unsupported URL scheme/));
});

suite("a scoped provider serves files with length and media type", async (t) => {
  const { root } = tree(t);
  const api = runtimeWith(t, root);

  const text = await api.fetch(pathToFileURL(join(root, "hello.txt")).href);
  assert.equal(text.status, 200);
  assert.equal(text.headers.get("content-type"), "text/plain;charset=UTF-8");
  assert.equal(text.headers.get("content-length"), "17");
  assert.equal(await text.text(), "hello from a file");

  const json = await api.fetch(pathToFileURL(join(root, "nested", "deep.json")).href);
  assert.equal(json.headers.get("content-type"), "application/json");
  assert.deepEqual(await json.json(), { ok: true });
});

suite("HEAD answers with the headers and no body", async (t) => {
  const { root } = tree(t);
  const api = runtimeWith(t, root);
  const response = await api.fetch(pathToFileURL(join(root, "hello.txt")).href, {
    method: "HEAD",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "17");
  assert.equal(response.body, null);
});

suite("a range request reads only the requested bytes", async (t) => {
  const { root } = tree(t);
  const api = runtimeWith(t, root);
  const response = await api.fetch(pathToFileURL(join(root, "hello.txt")).href, {
    headers: { range: "bytes=6-9" },
  });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "from");
  assert.equal(response.headers.get("content-range"), "bytes 6-9/17");
});

suite("a method other than GET or HEAD fails deterministically", async (t) => {
  const { root } = tree(t);
  const api = runtimeWith(t, root);
  await assert.rejects(
    api.fetch(pathToFileURL(join(root, "hello.txt")).href, { method: "POST", body: "x" }),
    because(/only GET and HEAD/),
  );
});

suite("a file URL naming a remote host or credentials is refused", async (t) => {
  const { root } = tree(t);
  const api = runtimeWith(t, root);
  await assert.rejects(api.fetch("file://elsewhere.example/etc/passwd"), because(/remote host/));
  await assert.rejects(api.fetch("file://user:pass@/etc/passwd"), TypeError);
  // localhost is the one host form that means "this machine" and is normalized away.
  const local = "file://localhost" + pathToFileURL(join(root, "hello.txt")).pathname;
  assert.equal(await (await api.fetch(local)).text(), "hello from a file");
});

suite("a path leaving the root is refused before it is opened", async (t) => {
  const { dir, root } = tree(t);
  const api = runtimeWith(t, root);
  // The URL parser normalizes dot segments, so this arrives as the parent path
  // rather than as traversal the provider has to detect textually.
  const traversal = pathToFileURL(join(root, "nested")).href + "/../../secret.txt";
  assert.equal(new URL(traversal).href, pathToFileURL(join(dir, "secret.txt")).href);
  await assert.rejects(api.fetch(traversal), because(/outside the permitted root/));
});

suite("a symlink inside the root pointing out of it is refused", async (t) => {
  const { root } = tree(t);
  const api = runtimeWith(t, root);
  // Textually this path is inside the root; only resolving it says otherwise.
  const escape = pathToFileURL(join(root, "escape.txt")).href;
  assert.match(escape, /\/root\/escape\.txt$/);
  await assert.rejects(api.fetch(escape), because(/outside the permitted root/));
});
