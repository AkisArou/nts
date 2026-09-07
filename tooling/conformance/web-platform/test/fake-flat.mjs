// One in-memory `FlatDurableStore`, shared by everything that needs a provider.
//
// Three copies of this appeared within two slices, which is how a fake stops being one
// fake: they drift, and a suite that passes against a drifted copy says nothing about
// the seam the others exercise. The counters are here rather than in one caller because
// the adapter's own suite asserts on them and nothing else should have to know that.
import assert from "node:assert/strict";

const encoder = new TextEncoder();
const at = (namespace, key) => `${namespace} ${key}`;

/** Decimal digits then NUL, as the record encoding writes them. */
function pushNumber(out, value) {
  for (const code of String(value)) out.push(code.charCodeAt(0));
  out.push(0);
}

export class FakeFlat {
  constructor() {
    this.values = new Map();
    this.writes = new Map();
    this.sources = new Map();
    this.live = new Set();
    this.next = 1;
    this.clock = 1000;
    this.closed = false;
    this.reads = 0;
    this.lists = 0;
  }

  open(namespace, key) {
    if (this.live.has(at(namespace, key))) return -1;
    this.live.add(at(namespace, key));
    const handle = this.next++;
    this.writes.set(handle, { namespace, key, chunks: [] });
    return handle;
  }

  append(handle, from) {
    const write = this.writes.get(handle);
    assert.ok(write, "append on a handle the adapter did not open");
    // Copied, because the caller owns the view it handed down.
    write.chunks.push(from.slice());
  }

  commit(handle) {
    const write = this.writes.get(handle);
    assert.ok(write, "commit on a handle the adapter did not open");
    let total = 0;
    for (const chunk of write.chunks) total += chunk.length;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of write.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.values.set(at(write.namespace, write.key), {
      key: write.key,
      namespace: write.namespace,
      bytes,
      modified: this.clock++,
    });
    this.writes.delete(handle);
    this.live.delete(at(write.namespace, write.key));
  }

  discard(handle) {
    const write = this.writes.get(handle);
    if (write === undefined) return;
    this.writes.delete(handle);
    this.live.delete(at(write.namespace, write.key));
  }

  read(namespace, key, into) {
    this.reads++;
    const record = this.values.get(at(namespace, key));
    if (record === undefined) return -1;
    into.set(record.bytes.subarray(0, Math.min(record.bytes.length, into.length)));
    return record.bytes.length;
  }

  remove(namespace, key) {
    return this.values.delete(at(namespace, key));
  }

  list(namespace, into) {
    this.lists++;
    const out = [];
    for (const record of this.values.values()) {
      if (record.namespace !== namespace) continue;
      const key = encoder.encode(record.key);
      pushNumber(out, record.bytes.length);
      pushNumber(out, record.modified);
      pushNumber(out, key.length);
      for (const byte of key) out.push(byte);
    }
    const bytes = Uint8Array.from(out);
    into.set(bytes.subarray(0, Math.min(bytes.length, into.length)));
    return bytes.length;
  }

  size(namespace) {
    let total = 0;
    for (const record of this.values.values()) {
      if (record.namespace === namespace) total += record.bytes.length;
    }
    return total;
  }

  sourceOpen(namespace, key, start, length) {
    const record = this.values.get(at(namespace, key));
    if (record === undefined) return -1;
    const handle = this.next++;
    this.sources.set(handle, {
      bytes: record.bytes,
      position: start,
      end: Math.min(start + length, record.bytes.length),
    });
    return handle;
  }

  sourceRead(handle, into) {
    const source = this.sources.get(handle);
    assert.ok(source, "sourceRead on a handle the adapter did not open");
    if (source.position >= source.end) return -1;
    const count = Math.min(into.length, source.end - source.position);
    into.set(source.bytes.subarray(source.position, source.position + count));
    source.position += count;
    return count;
  }

  sourceClose(handle) {
    this.sources.delete(handle);
  }

  sourceSize(namespace, key) {
    const record = this.values.get(at(namespace, key));
    return record === undefined ? -1 : record.bytes.length;
  }

  close() {
    this.closed = true;
  }
}
