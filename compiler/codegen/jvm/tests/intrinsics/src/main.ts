// TypeScript calling the fixed networking intrinsics, compiled to JVM.
//
// The plan says host Java tests alone are insufficient, and it is right: every
// test this lane had drove `nts.rt` from a Java `main`, which proves the
// runtime works and proves nothing about whether a *program* can reach it.
// Between the two sits the extern table, and a name missing from it is a
// refusal no amount of Java testing can see. This fixture existed for one
// minute in a form where every function returned zero, which would have passed
// against a table that mapped all four names to the wrong method.
//
// Five of nine. Four take only `number` and `void`; the fifth takes a byte
// view, which `ManagedType::View` supplied. The remaining four want an
// environment handle, which has no common type -- see
// `runtime/jvm/web-platform/intrinsics.d.ts`, where the gated entries say
// so. They are named rather than silently the ones that happened to work.
//
// The declarations are not here. They come from
// `runtime/jvm/web-platform/intrinsics.d.ts` through this fixture's
// tsconfig, so calling one with the wrong arity or the wrong type stops
// compiling. Restating them here compiled just as well and asserted nothing --
// which is what four hand-written copies of one ABI buys.
//
// And the calls go through `socket.ts` rather than naming the flat intrinsics,
// because that is how a provider will be written: the FFI spelling named once,
// in one module, and `openCount()` everywhere else. It also puts that module on
// the path this test already walks, so the wrapper is compiled by the JVM
// backend rather than merely typechecked.

import * as socket from "../../../../../../runtime/jvm/web-platform/socket.ts";

/**
 * How many connections the provider is holding.
 *
 * Named `openNow` rather than `openCount` because the wrapper exports that name
 * too, and two modules exporting one name is a collision the backend resolves
 * by qualifying both -- `openCount@socket` and `openCount@main`. Correct, and
 * invisible to a driver that reflects for `openCount`. Renaming the probe keeps
 * this test about the intrinsic boundary rather than about name mangling, which
 * has its own tests.
 */
export function openNow(): number {
  return socket.openCount();
}

/** Close one, and report what is left -- so the close is observable, not assumed. */
export function closeOne(handle: number): number {
  socket.close(handle);
  return socket.openCount();
}

/**
 * Cancelling a request that was never issued is idempotent and must disturb
 * nothing. The count is returned rather than nothing at all because "did not
 * throw" is a weaker claim than "did not close someone else's socket", and the
 * second is the one that matters during teardown.
 */
export function cancelUnissued(request: number): number {
  socket.cancelConnect(request);
  return socket.openCount();
}

/**
 * The default network changed: every connection on the old one is gone, and
 * this reports how many that was.
 *
 * Not a no-op that waits for the reads to fail. A socket on a replaced network
 * reports nothing for as long as the kernel will allow, so the failure a
 * program eventually sees is a timeout arriving long after its cause.
 */
export function changed(): number {
  return socket.networkChanged();
}

/**
 * Fill thirty-two bytes and report how many are not zero.
 *
 * A stub that did nothing answers 0, which is what this distinguishes. It is
 * not a test of randomness -- that is `SecureRandom`'s job and not something a
 * corpus can assert -- it is a test that the bytes crossed the boundary at all.
 *
 * Thirty-two rather than one: a single byte is zero once in every 256 fills,
 * which would be a flaky test. All thirty-two being zero has probability 2^-256,
 * which is below the rate at which the hardware gets arithmetic wrong.
 */
export function randomBytes(): number {
  const bytes = new Uint8Array(32);
  socket.randomFill(bytes);
  let set = 0;
  for (let i = 0; i < 32; i = i + 1) {
    if (bytes[i]! !== 0) {
      set = set + 1;
    }
  }
  return set;
}

// `randomStaysInsideItsWindow` was here and cannot be: `new Uint8Array(backing,
// 8, 16)` is `NTS1001 a \`new Uint8Array\` from a value is not supported by this
// lowering yet`, so a window cannot be constructed in TypeScript at all. The
// property is real and is asserted in `Drive.java`, where a window can be built
// -- named here rather than left out, because a fill that ignored the view's
// offset would pass every case above.

// ---------------------------------------------------------------------------
// A round trip, driven from TypeScript.
//
// The four scalar intrinsics prove a call arrives. This proves the rest of the
// ABI: a closure written in TypeScript, compiled to a class implementing an
// `nts.rt` interface, called back by a worker thread and delivered on the owner
// lane; and a `Uint8Array` crossing as a view that carries its own window.
//
// Split into start/step/report because a completion arrives when the
// environment is drained, and only the driver can drain it. Module state holds
// what the callbacks saw, which is also what a provider written in this
// language would do.
// ---------------------------------------------------------------------------

let state = 0;
let failure = "";
let handle = -1;
let wrote = 0;
let got = 0;
const inbound = new Uint8Array(16);

/** 0 pending, 1 open, 2 written, 3 read; negative is the step that failed. */
export function status(): number {
  return state;
}

/**
 * Named `dial` rather than `open` for the reason `openNow` is not `openCount`:
 * `store.ts` exports an `open` too, and two modules exporting one name is a
 * collision the backend resolves by qualifying both -- `open@main` and
 * `open@store`. Correct, and invisible to a driver that reflects for `open`,
 * which then fails with `NoSuchMethodException` naming a method that plainly
 * exists in the source.
 */
export function dial(port: number): void {
  socket.connect(
    "127.0.0.1", port, false, 4000, null, 0, socket.DIRECT,
    (h: number): void => {
      handle = h;
      state = 1;
    },
    (code: string, message: string): void => {
      state = -1;
      failure = code + ": " + message;
    },
  );
}

/** Five bytes, written from a view. */
export function send(): void {
  const out = new Uint8Array(5);
  out[0] = 110;
  out[1] = 116;
  out[2] = 115;
  out[3] = 45;
  out[4] = 106;
  socket.write(
    handle, out,
    (n: number): void => {
      wrote = n;
      state = 2;
    },
    (code: string, message: string): void => {
      state = -2;
      failure = code + ": " + message;
    },
  );
}

export function receive(): void {
  socket.read(
    handle, inbound,
    (n: number): void => {
      got = n;
      state = 3;
    },
    (code: string, message: string): void => {
      state = -3;
      failure = code + ": " + message;
    },
  );
}

export function received(): number {
  return got;
}

/** The bytes read back, summed, so one number says whether they came through. */
export function checksum(): number {
  let total = 0;
  for (let i = 0; i < got; i = i + 1) {
    total = total + inbound[i]!;
  }
  return total;
}

/** What the last failing callback was told, for a driver to print. */
export function whyItFailed(): string {
  return failure;
}

/** The handle the open callback was given. */
export function currentHandle(): number {
  return handle;
}

export function written(): number {
  return wrote;
}

export function shut(): void {
  socket.close(handle);
}

// ---------------------------------------------------------------------------
// The durable store, reached the same way: through a wrapper module rather than
// by naming the flat intrinsics.
//
// The point of driving it from here rather than only from `StoreTest` is the
// same point the file opens with. `StoreTest` proves the runtime works; this
// proves a *compiled program* can reach it, and between the two sits the extern
// table, where a missing name is a refusal no Java test can see.
//
// It answers one string rather than a number per fact, because a driver that
// reflects for nine doubles would need nine names and nine assertions, and the
// interesting failure -- one of them wrong -- reads the same either way.

import * as store from "../../../../../../runtime/jvm/web-platform/store.ts";

/** Exercises every store intrinsic that a program can reach synchronously. */
export function storeRoundTrip(): string {
  const payload = new Uint8Array(5);
  payload[0] = 10;
  payload[1] = 20;
  payload[2] = 30;
  payload[3] = 40;
  payload[4] = 50;

  const write = store.open("ns", "k");
  store.append(write, payload);
  // Nothing is visible under the key until the commit, and this is where a
  // compiled program can see that rather than taking it on trust.
  const before = store.sourceSize("ns", "k");
  store.commit(write);

  const back = new Uint8Array(8);
  const size = store.read("ns", "k", back);
  let sum = 0;
  for (let i = 0; i < size; i = i + 1) {
    sum = sum + back[i]!;
  }

  // A two-byte window over a three-byte range: two chunks and then the end,
  // which is `-1` rather than an empty chunk.
  const source = store.sourceOpen("ns", "k", 1, 3);
  const chunk = new Uint8Array(2);
  const first = store.sourceRead(source, chunk);
  const firstSum = chunk[0]! + chunk[1]!;
  const second = store.sourceRead(source, chunk);
  const secondByte = chunk[0]!;
  const end = store.sourceRead(source, chunk);
  store.sourceClose(source);

  const total = store.size("ns");
  const absent = store.sourceSize("ns", "nothing");

  // One record: `5 NUL <time> NUL 1 NUL k`. Parsed rather than measured -- the
  // total length depends on how many digits the current millisecond takes, and
  // a test that asserted 19 would be asserting the year.
  const listed = new Uint8Array(64);
  const needed = store.list("ns", listed);
  let field = 0;
  let recordSize = 0;
  let keyLength = 0;
  let keyByte = 0;
  for (let i = 0; i < needed; i = i + 1) {
    const byte = listed[i]!;
    if (byte === 0) {
      field = field + 1;
    } else if (field === 0) {
      recordSize = recordSize * 10 + (byte - 48);
    } else if (field === 2) {
      keyLength = keyLength * 10 + (byte - 48);
    } else if (field === 3) {
      keyByte = byte;
    }
  }

  // A write that is abandoned leaves the key alone and releases it.
  const abandoned = store.open("ns", "k");
  store.discard(abandoned);
  const after = store.sourceSize("ns", "k");

  const removed = store.remove("ns", "k") ? 1 : 0;
  const gone = store.sourceSize("ns", "k");

  return "before " + before + " size " + size + " sum " + sum
    + " first " + first + " firstSum " + firstSum
    + " second " + second + " secondByte " + secondByte + " end " + end
    + " total " + total + " absent " + absent
    + " recordSize " + recordSize + " keyLength " + keyLength + " keyByte " + keyByte
    + " after " + after + " removed " + removed + " gone " + gone;
}

/** The proxy result string the platform gives for a URL. */
export function proxyFor(): string {
  return socket.systemProxyFor("http://example.com/a");
}

/** And for a host the bypass list covers, which must come back direct. */
export function proxyForBypassed(): string {
  return socket.systemProxyFor("http://localhost/a");
}
