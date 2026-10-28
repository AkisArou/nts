// File API source-policy controls. Node 24.20.0 has no FileReader or ProgressEvent;
// these new surfaces are checked against their specifications, not a host wrapper.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createHostNodePrimitives, createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { DOMException } from "../src/core/errors.ts";
import { Event } from "../src/core/events.ts";
import { ProgressEvent } from "../src/core/progress-event.ts";
import type { ProgressEventInit } from "../src/core/progress-event.ts";
import { Blob, _createBlobFromExternalSource } from "../src/file/blob.ts";
import type { BlobExternalSource } from "../src/file/blob.ts";
import { FileReader } from "../src/file/file-reader.ts";
import type { FileReaderEventHandlerValue } from "../src/file/file-reader.ts";
import { installWebPlatformRuntime, VirtualScheduler, WebPlatformRuntime } from "../src/provider.ts";

const hostRuntime = createHostNodeWebPlatform();
after(() => hostRuntime.close());

function virtualRuntime(t: TestContext): VirtualScheduler {
  const scheduler = new VirtualScheduler();
  const runtime = new WebPlatformRuntime({
    ...createHostNodePrimitives(),
    scheduler,
    monotonicMilliseconds: () => scheduler.now,
  });
  installWebPlatformRuntime(runtime);
  t.after(() => {
    runtime.close();
    installWebPlatformRuntime(hostRuntime);
  });
  return scheduler;
}

// https://xhr.spec.whatwg.org/#interface-progressevent
test("ProgressEvent preserves Event options and finite-double progress values", () => {
  const defaults = new ProgressEvent("progress");
  assert.ok(defaults instanceof Event);
  assert.equal(defaults.lengthComputable, false);
  assert.equal(defaults.loaded, 0);
  assert.equal(defaults.total, 0);
  assert.equal(defaults.isTrusted, false);
  const event = new ProgressEvent("progress", {
    bubbles: true, cancelable: true, composed: true,
    lengthComputable: true, loaded: -0.5, total: -0,
  });
  assert.equal(event.bubbles, true);
  assert.equal(event.cancelable, true);
  assert.equal(event.composed, true);
  assert.equal(event.lengthComputable, true);
  assert.equal(event.loaded, -0.5);
  assert.ok(Object.is(event.total, -0));
});

test("ProgressEvent converts inherited dictionary members before its own and captures time afterward", (t) => {
  const scheduler = virtualRuntime(t);
  const order: string[] = [];
  const init = {
    get bubbles() { order.push("bubbles"); return false; },
    get cancelable() { order.push("cancelable"); return false; },
    get composed() { order.push("composed"); return false; },
    get lengthComputable() { order.push("lengthComputable"); return true; },
    get loaded() {
      order.push("loaded");
      return { valueOf() { order.push("loaded valueOf"); scheduler.advance(10); return 1.5; } };
    },
    get total() { order.push("total"); return 2.5; },
  } as unknown as ProgressEventInit;
  const event = new ProgressEvent("progress", init);
  assert.deepEqual(order, ["bubbles", "cancelable", "composed", "lengthComputable", "loaded", "loaded valueOf", "total"]);
  assert.equal(event.timeStamp, 10);
  assert.equal(event.loaded, 1.5);
  assert.equal(event.total, 2.5);
});

test("ProgressEvent rejects non-finite doubles, invalid dictionaries, and missing type", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => new ProgressEvent("progress", { loaded: value }), TypeError);
    assert.throws(() => new ProgressEvent("progress", { total: value }), TypeError);
  }
  assert.throws(() => new ProgressEvent("progress", 1 as unknown as ProgressEventInit), TypeError);
  // @ts-expect-error Web IDL required-argument control.
  assert.throws(() => new ProgressEvent(), TypeError);
  assert.throws(() => new ProgressEvent("progress", { loaded: 1n as unknown as number }), TypeError);
});

interface ReaderEventRecord {
  event: Event;
  type: string;
  state: number;
  result: string | ArrayBuffer | null;
  error: DOMException | null;
  target: unknown;
  currentTarget: unknown;
}

function recordEvents(reader: FileReader): ReaderEventRecord[] {
  const records: ReaderEventRecord[] = [];
  for (const type of ["loadstart", "progress", "load", "abort", "error", "loadend"]) {
    reader.addEventListener(type, (event) => {
      records.push({
        event, type, state: reader.readyState, result: reader.result, error: reader.error,
        target: event.target, currentTarget: event.currentTarget,
      });
    });
  }
  return records;
}

function completeRead(reader: FileReader, start: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    reader.addEventListener("loadend", () => resolve(), { once: true });
    try { start(); } catch (error) { reject(error); }
  });
}

function isDOMException(name: string): (error: unknown) => boolean {
  return (error) => error instanceof DOMException && error.name === name;
}

// https://w3c.github.io/FileAPI/#dfn-filereader
// https://w3c.github.io/FileAPI/#readOperation
test("FileReader starts empty with null result, error, and event handlers", () => {
  const reader = new FileReader();
  assert.equal(reader.readyState, FileReader.EMPTY);
  assert.equal(reader.result, null);
  assert.equal(reader.error, null);
  assert.deepEqual([reader.EMPTY, reader.LOADING, reader.DONE], [0, 1, 2]);
  assert.deepEqual([FileReader.EMPTY, FileReader.LOADING, FileReader.DONE], [0, 1, 2]);
  assert.deepEqual([
    reader.onloadstart, reader.onprogress, reader.onload, reader.onabort, reader.onerror, reader.onloadend,
  ], [null, null, null, null, null, null]);
});

test("FileReader reads asynchronously and exposes trusted progress events in state order", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  const records = recordEvents(reader);
  const completion = completeRead(reader, () => reader.readAsText(new Blob(["hello"])));
  assert.equal(reader.readyState, FileReader.LOADING);
  assert.equal(reader.result, null);
  assert.equal(reader.error, null);
  assert.equal(records.length, 0);
  await completion;
  assert.equal(reader.result, "hello");
  assert.equal(reader.error, null);
  assert.deepEqual(records.map((record) => [record.type, record.state, record.result]), [
    ["loadstart", FileReader.LOADING, null], ["progress", FileReader.LOADING, null],
    ["load", FileReader.DONE, "hello"], ["loadend", FileReader.DONE, "hello"],
  ]);
  assert.deepEqual(records.map((record) => (record.event as ProgressEvent).loaded), [0, 5, 5, 5]);
  for (const record of records) {
    assert.ok(record.event instanceof ProgressEvent);
    assert.equal(record.event.isTrusted, true);
    assert.equal(record.event.bubbles, false);
    assert.equal(record.event.cancelable, false);
    assert.equal(record.event.lengthComputable, true);
    assert.equal(record.event.total, 5);
    assert.equal(record.target, reader);
    assert.equal(record.currentTarget, reader);
    assert.equal(record.error, null);
  }
});

test("FileReader completes an empty Blob without a spurious progress event", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  const records = recordEvents(reader);
  await completeRead(reader, () => reader.readAsText(new Blob()));
  assert.equal(reader.result, "");
  assert.deepEqual(records.map((record) => record.type), ["loadstart", "load", "loadend"]);
  for (const record of records) {
    const event = record.event as ProgressEvent;
    assert.equal(event.lengthComputable, false);
    assert.equal(event.loaded, 0);
    assert.equal(event.total, 0);
  }
});

// This is the read/event interface required by the WebSocket Blob-isolation WPT.
test("FileReader onload returns independent ArrayBuffers over immutable Blob storage", { timeout: 2000 }, async () => {
  let publicCalls = 0;
  class DerivedBlob extends Blob {
    override get size(): never { publicCalls++; throw new Error("public size"); }
    override get type(): never { publicCalls++; throw new Error("public type"); }
    override stream(): never { publicCalls++; throw new Error("public stream"); }
    override arrayBuffer(): never { publicCalls++; throw new Error("public arrayBuffer"); }
    override bytes(): never { publicCalls++; throw new Error("public bytes"); }
  }
  const input = new Uint8Array([0, 128, 255]);
  const blob = new DerivedBlob([input]);
  input.fill(42);
  const reader = new FileReader();
  const callbackReceivers: FileReader[] = [];
  function read(): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      reader.onload = function () {
        callbackReceivers.push(this);
        if (!(this.result instanceof ArrayBuffer)) { reject(new Error("expected ArrayBuffer")); return; }
        resolve(new Uint8Array(this.result));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }
  const first = await read();
  assert.deepEqual(first, new Uint8Array([0, 128, 255]));
  first.fill(7);
  const second = await read();
  assert.deepEqual(second, new Uint8Array([0, 128, 255]));
  assert.notEqual(first.buffer, second.buffer);
  assert.deepEqual(callbackReceivers, [reader, reader]);
  assert.equal(publicCalls, 0);
});

test("FileReader BinaryString keeps every byte's code-unit value", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  await completeRead(reader, () => reader.readAsBinaryString(new Blob([new Uint8Array([0, 65, 127, 128, 255])])));
  assert.equal(reader.result, "\0A\x7f\x80\xff");
  assert.equal(reader.error, null);
});

// Web IDL interface conversion precedes the File API busy-state algorithm.
test("FileReader converts arguments before rejecting overlapping reads", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  const blob = new Blob(["one"]);
  const completion = completeRead(reader, () => reader.readAsText(blob));
  for (const read of [reader.readAsArrayBuffer, reader.readAsBinaryString, reader.readAsText]) {
    assert.throws(() => read.call(reader, blob), isDOMException("InvalidStateError"));
    assert.throws(() => read.call(reader, {} as Blob), TypeError);
    // @ts-expect-error Web IDL required-argument control.
    assert.throws(() => read.call(reader), TypeError);
    assert.throws(() => read.call({} as FileReader, blob), TypeError);
  }
  const marker = new Error("encoding conversion");
  let conversions = 0;
  const label = { toString() { conversions++; throw marker; } } as unknown as string;
  assert.throws(() => reader.readAsText(blob, label), (error) => error === marker);
  assert.equal(conversions, 1);
  assert.throws(() => reader.readAsText(blob, Symbol("encoding") as unknown as string), TypeError);
  assert.equal(reader.readyState, FileReader.LOADING);
  await completion;
  assert.equal(reader.result, "one");
});

// https://w3c.github.io/FileAPI/#abort
test("FileReader abort before a read preserves EMPTY and fires no events", () => {
  const reader = new FileReader();
  const records = recordEvents(reader);
  reader.abort();
  assert.equal(reader.readyState, FileReader.EMPTY);
  assert.equal(reader.result, null);
  assert.equal(reader.error, null);
  assert.deepEqual(records, []);
  assert.throws(() => reader.abort.call({} as FileReader), TypeError);
});

test("FileReader abort synchronously retires pending events and permits a fresh read", { timeout: 2000 }, async (t) => {
  const scheduler = virtualRuntime(t);
  const reader = new FileReader();
  const records = recordEvents(reader);
  reader.readAsText(new Blob(["old"]));
  // Permit the stream to resolve and queue tasks, but do not run those tasks.
  await nextTurn();
  assert.equal(scheduler.hasPending, true);
  reader.abort();
  assert.equal(reader.readyState, FileReader.DONE);
  assert.equal(reader.result, null);
  assert.equal(reader.error, null);
  assert.deepEqual(records.map((record) => record.type), ["abort", "loadend"]);
  scheduler.runPending();
  assert.deepEqual(records.map((record) => record.type), ["abort", "loadend"]);
  reader.readAsText(new Blob(["new"]));
  await nextTurn();
  scheduler.runPending();
  assert.equal(reader.result, "new");
  assert.deepEqual(records.map((record) => record.type), ["abort", "loadend", "loadstart", "progress", "load", "loadend"]);
  assert.deepEqual(scheduler.errors, []);
});

test("FileReader abort after success only clears the result", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  const records = recordEvents(reader);
  await completeRead(reader, () => reader.readAsText(new Blob(["done"])));
  const count = records.length;
  reader.abort();
  assert.equal(reader.readyState, FileReader.DONE);
  assert.equal(reader.result, null);
  assert.equal(reader.error, null);
  assert.equal(records.length, count);
});

test("FileReader abort in loadstart suppresses queued progress and completion", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  const records = recordEvents(reader);
  reader.onloadstart = () => reader.abort();
  await completeRead(reader, () => reader.readAsText(new Blob(["old"])));
  await nextTurn();
  assert.deepEqual(records.map((record) => record.type), ["loadstart", "abort", "loadend"]);
  assert.equal(reader.result, null);
});

test("FileReader suppresses the old loadend when a load handler starts another read", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  const records = recordEvents(reader);
  const results: (string | ArrayBuffer | null)[] = [];
  reader.onload = () => {
    results.push(reader.result);
    if (results.length === 1) reader.readAsText(new Blob(["second"]));
  };
  await completeRead(reader, () => reader.readAsText(new Blob(["first"])));
  assert.deepEqual(results, ["first", "second"]);
  assert.deepEqual(records.map((record) => record.type), [
    "loadstart", "progress", "load", "loadstart", "progress", "load", "loadend",
  ]);
  assert.equal(reader.result, "second");
});

test("FileReader suppresses the old loadend when an abort handler starts another read", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  const records = recordEvents(reader);
  reader.onabort = () => reader.readAsText(new Blob(["replacement"]));
  await completeRead(reader, () => {
    reader.readAsText(new Blob(["old"]));
    reader.abort();
  });
  assert.deepEqual(records.map((record) => record.type), ["abort", "loadstart", "progress", "load", "loadend"]);
  assert.equal(reader.result, "replacement");
});

test("FileReader closes external storage on abort and ignores its late completion", { timeout: 2000 }, async () => {
  let opens = 0;
  let closes = 0;
  const pending = Promise.withResolvers<Uint8Array<ArrayBuffer> | undefined>();
  const source: BlobExternalSource = {
    size: 1,
    open() {
      opens++;
      const index = opens;
      return {
        read() { return index === 1 ? pending.promise : Promise.resolve(new Uint8Array([9])); },
        async close() { closes++; },
      };
    },
  };
  const blob = _createBlobFromExternalSource(source);
  const reader = new FileReader();
  const records = recordEvents(reader);
  reader.readAsArrayBuffer(blob);
  await nextTurn();
  assert.equal(opens, 1);
  reader.abort();
  assert.equal(closes, 1);
  const completion = completeRead(reader, () => reader.readAsArrayBuffer(blob));
  pending.resolve(new Uint8Array([1]));
  await completion;
  assert.equal(opens, 2);
  assert.equal(closes, 2);
  assert.ok(reader.result instanceof ArrayBuffer);
  assert.deepEqual(new Uint8Array(reader.result), new Uint8Array([9]));
  assert.deepEqual(records.map((record) => record.type), ["abort", "loadend", "loadstart", "progress", "load", "loadend"]);
});

test("FileReader reports storage failure, retains its error on abort, and clears it on the next read", { timeout: 2000 }, async () => {
  let closes = 0;
  const source: BlobExternalSource = {
    size: 1,
    open() {
      return {
        async read() { throw new Error("storage failed"); },
        async close() { closes++; },
      };
    },
  };
  const reader = new FileReader();
  const records = recordEvents(reader);
  await completeRead(reader, () => reader.readAsArrayBuffer(_createBlobFromExternalSource(source)));
  assert.equal(closes, 1);
  assert.equal(reader.readyState, FileReader.DONE);
  assert.equal(reader.result, null);
  assert.ok(isDOMException("NotReadableError")(reader.error));
  assert.deepEqual(records.map((record) => record.type), ["error", "loadend"]);
  const error = reader.error;
  reader.abort();
  assert.equal(reader.error, error);
  const completion = completeRead(reader, () => reader.readAsText(new Blob(["recovered"])));
  assert.equal(reader.error, null);
  assert.equal(reader.result, null);
  await completion;
  assert.equal(reader.result, "recovered");
});

test("FileReader suppresses the old loadend when an error handler starts another read", { timeout: 2000 }, async () => {
  const source: BlobExternalSource = {
    size: 1,
    open() { return { async read() { throw new Error("unreadable"); }, async close() {} }; },
  };
  const reader = new FileReader();
  const records = recordEvents(reader);
  reader.onerror = () => reader.readAsText(new Blob(["recovered"]));
  await completeRead(reader, () => reader.readAsArrayBuffer(_createBlobFromExternalSource(source)));
  assert.deepEqual(records.map((record) => record.type), ["error", "loadstart", "progress", "load", "loadend"]);
  assert.equal(reader.result, "recovered");
  assert.equal(reader.error, null);
});

test("FileReader progress uses provider time and includes the final byte count", { timeout: 2000 }, async (t) => {
  const scheduler = virtualRuntime(t);
  const chunks = [
    Promise.withResolvers<Uint8Array<ArrayBuffer> | undefined>(),
    Promise.withResolvers<Uint8Array<ArrayBuffer> | undefined>(),
    Promise.withResolvers<Uint8Array<ArrayBuffer> | undefined>(),
  ];
  let index = 0;
  const source: BlobExternalSource = {
    size: 3,
    open() {
      return {
        read() {
          const chunk = chunks[index++];
          if (chunk === undefined) throw new Error("unexpected extra read");
          return chunk.promise;
        },
        async close() {},
      };
    },
  };
  const reader = new FileReader();
  const records = recordEvents(reader);
  reader.readAsArrayBuffer(_createBlobFromExternalSource(source));
  chunks[0]!.resolve(new Uint8Array([1]));
  await nextTurn();
  scheduler.runPending();
  assert.deepEqual(records.map((record) => record.type), ["loadstart"]);
  scheduler.advance(50);
  chunks[1]!.resolve(new Uint8Array([2]));
  await nextTurn();
  scheduler.runPending();
  assert.deepEqual(records.map((record) => record.type), ["loadstart", "progress"]);
  scheduler.advance(25);
  chunks[2]!.resolve(new Uint8Array([3]));
  await nextTurn();
  scheduler.runPending();
  assert.deepEqual(records.map((record) => [record.type, (record.event as ProgressEvent).loaded]), [
    ["loadstart", 0], ["progress", 2], ["progress", 3], ["load", 3], ["loadend", 3],
  ]);
  for (const record of records.filter((record) => record.type === "progress")) {
    assert.equal(record.state, FileReader.LOADING);
    assert.equal((record.event as ProgressEvent).total, 3);
  }
  assert.deepEqual(scheduler.errors, []);
});

// https://w3c.github.io/FileAPI/#package-data
test("FileReader text uses its explicit encoding before the private MIME charset", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  const be = new Blob([new Uint8Array([0, 65, 0, 233])], { type: "text/plain;charset=utf-16be" });
  await completeRead(reader, () => reader.readAsText(be));
  assert.equal(reader.result, "Aé");
  await completeRead(reader, () => reader.readAsText(be, "utf-8"));
  assert.equal(reader.result, "\0A\0�");
  let publicReads = 0;
  class DerivedBlob extends Blob {
    override get type(): never { publicReads++; throw new Error("public type"); }
  }
  await completeRead(reader, () => reader.readAsText(new DerivedBlob([new Uint8Array([0, 65])], {
    type: 'text/plain; charset="utf-16be"',
  })));
  assert.equal(reader.result, "A");
  assert.equal(publicReads, 0);
});

test("FileReader invalid encoding labels fall back through MIME and UTF-8", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  const be = new Blob([new Uint8Array([0, 65])], { type: "text/plain;charset=utf-16be" });
  for (const label of ["not-an-encoding", "", "\vutf-16le", "Koi8-r"]) {
    await completeRead(reader, () => reader.readAsText(be, label));
    assert.equal(reader.result, "A", label);
    assert.equal(reader.error, null);
  }
  await completeRead(reader, () => reader.readAsText(new Blob(["é"], { type: "text/plain;charset=invalid" }), "invalid"));
  assert.equal(reader.result, "é");
  await completeRead(reader, () => reader.readAsText(new Blob(["é"])));
  assert.equal(reader.result, "é");
});

test("FileReader BOM decoding overrides the explicit or MIME fallback encoding", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  for (const bytes of [
    new Uint8Array([0xef, 0xbb, 0xbf, 0x41]),
    new Uint8Array([0xff, 0xfe, 0x41, 0]),
    new Uint8Array([0xfe, 0xff, 0, 0x41]),
  ]) {
    await completeRead(reader, () => reader.readAsText(new Blob([bytes], { type: "text/plain;charset=utf-16be" }), "windows-1252"));
    assert.equal(reader.result, "A");
    assert.equal(reader.error, null);
  }
});

test("FileReader converts an encoding object once when the read starts", { timeout: 2000 }, async () => {
  let calls = 0;
  const label = { toString() { calls++; return "utf-16be"; } } as unknown as string;
  const reader = new FileReader();
  const completion = completeRead(reader, () => reader.readAsText(new Blob([new Uint8Array([0, 65])]), label));
  assert.equal(calls, 1);
  await completion;
  assert.equal(reader.result, "A");
  assert.equal(calls, 1);
});

test("FileReader exposes the missing legacy-codec capability without a false UTF-8 success", { timeout: 2000 }, async () => {
  const reader = new FileReader();
  for (const label of ["latin1", "  WINDOWS-1252\t", "Shift_JIS", "replacement"]) {
    const records = recordEvents(reader);
    await completeRead(reader, () => reader.readAsText(new Blob([new Uint8Array([0x80])]), label));
    assert.equal(reader.result, null);
    assert.ok(isDOMException("NotSupportedError")(reader.error));
    assert.deepEqual(records.map((record) => record.type), ["loadstart", "progress", "error", "loadend"]);
  }
  await completeRead(reader, () => reader.readAsText(new Blob([new Uint8Array([0x80])], { type: "text/plain;charset=latin1" })));
  assert.ok(isDOMException("NotSupportedError")(reader.error));
});

// https://html.spec.whatwg.org/multipage/webappapis.html#event-handlers
test("FileReader handler replacement preserves registration order and clearing re-adds at the end", () => {
  const reader = new FileReader();
  const order: string[] = [];
  reader.addEventListener("load", () => order.push("first"));
  reader.onload = () => order.push("old");
  reader.addEventListener("load", () => order.push("last"));
  reader.onload = () => order.push("replacement");
  reader.dispatchEvent(new Event("load"));
  assert.deepEqual(order, ["first", "replacement", "last"]);
  order.length = 0;
  reader.onload = null;
  reader.onload = () => order.push("re-added");
  reader.dispatchEvent(new Event("load"));
  assert.deepEqual(order, ["first", "last", "re-added"]);
});

test("FileReader HTML handlers retain non-callable objects but treat primitives as null", () => {
  const reader = new FileReader();
  let calls = 0;
  const object = { handleEvent() { calls++; } };
  reader.onload = object;
  assert.equal(reader.onload, object);
  reader.dispatchEvent(new Event("load"));
  assert.equal(calls, 0);
  for (const value of [undefined, false, 0, "handler", Symbol("handler")]) {
    reader.onload = value as unknown as FileReaderEventHandlerValue;
    assert.equal(reader.onload, null);
  }
});

test("FileReader handlers ignore a shadowed call and return false cancels synthetic events", () => {
  const reader = new FileReader();
  const calls: unknown[] = [];
  reader.onload = Object.assign(function (this: FileReader, event: Event) {
    calls.push(this, event);
    return false;
  }, { call() { throw new Error("public call must not be read"); } });
  const event = new Event("load", { cancelable: true });
  assert.equal(reader.dispatchEvent(event), false);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(calls, [reader, event]);
});

test("FileReader listener exceptions reach the provider without stopping later listeners", (t) => {
  const scheduler = virtualRuntime(t);
  const reader = new FileReader();
  const marker = new Error("listener failed");
  const calls: string[] = [];
  reader.onload = () => { calls.push("handler"); throw marker; };
  reader.addEventListener("load", () => calls.push("listener"));
  assert.doesNotThrow(() => reader.dispatchEvent(new Event("load")));
  assert.deepEqual(calls, ["handler", "listener"]);
  assert.deepEqual(scheduler.errors, [marker]);
});

// HTML activates/deactivates handler listeners internally, without invoking the
// target's user-overridable addEventListener/removeEventListener methods.
test("FileReader handler assignment bypasses subclass listener-registration overrides", () => {
  const calls: string[] = [];
  class DerivedReader extends FileReader {
    override addEventListener(): never { calls.push("public add"); throw new Error("public add"); }
    override removeEventListener(): never { calls.push("public remove"); throw new Error("public remove"); }
  }
  const reader = new DerivedReader();
  assert.doesNotThrow(() => { reader.onload = () => calls.push("handler"); });
  reader.dispatchEvent(new Event("load"));
  assert.deepEqual(calls, ["handler"]);
  assert.doesNotThrow(() => { reader.onload = null; });
  reader.dispatchEvent(new Event("load"));
  assert.deepEqual(calls, ["handler"]);
  assert.doesNotThrow(() => { reader.onload = () => calls.push("replacement"); });
  reader.dispatchEvent(new Event("load"));
  assert.deepEqual(calls, ["handler", "replacement"]);
});
