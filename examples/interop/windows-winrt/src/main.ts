// The Windows Runtime from TypeScript: `Windows.Data.Json`, which needs no
// window and no package identity, called through COM vtables.
//
// Each value reported depends on one part working:
// - `number` and `text`: `JsonValue.Parse` is a static, called on the
//   class's cached activation factory with an HSTRING argument; `GetNumber` writes a double
//   through its result slot, `Stringify` an HSTRING copied into a `string`.
// - `activations`: one per factory the program asks for, however often it
//   calls through it -- three parses through `JsonValue`'s are one, so a
//   cache that never hit would answer the same values and count more. 5, the
//   fifth being `JsonObject`'s statics, which the `pairs` walk parses with.
// - `pairs`: an `IIterable<T>` that is not a vector, walked by the iterator
//   its `First` makes -- `get_Current`, then `MoveNext` -- as C# walks one.
// - `bools`: a `boolean` both ways -- passed to `CreateBooleanValue` (which
//   `Stringify` then shows) and read back from `GetBoolean`, one byte each.
// - `languages`: a generic interface, `IVectorView<HString>` from
//   `Windows.Globalization` -- `size` and `getAt`, its own surface
//   (`IVectorViewMembers<T>`), through the table of the instantiation the
//   static handed back, whatever `T` it was made for. What
//   the machine's languages are is its own, so the line says only that there
//   is one and that the first is a BCP-47 tag.
// - `vector`: a class's other interface, by `QueryInterface` with the IID the
//   Windows Runtime computes for `IVector<IJsonValue>` -- `as_IVector` on a
//   `JsonArray`, whose own interface is `IJsonArray`. A wrong IID ends the
//   process naming it rather than printing anything. Then `for...of` over
//   another's, summing its numbers.
// - `built`: a runtime class made by its default constructor
//   (`new JsonObject()`, `ActivateInstance` then its default interface),
//   filled, and read back through another of its interfaces.
// - `threw`: an HRESULT failure, thrown as an `Error` naming the code.
// - `closed`: an event, a TypeScript function as a delegate (see `events`).
// - `structs`: records by value, both sizes Win64 passes (see `structs`).
// - `outs`: `[out]` parameters, as fields of the result (see `outs`).
// - `bytes`: byte arrays both ways, and one handed back; `elements`, arrays
//   of numbers both ways, boxed and unboxed (see `bytes` and `elements`).
// - `filled`: arrays the callee fills -- objects, strings, structs.
// - `map`: a class whose default interface is an instantiation (see `map`).
// - `guids`: `Guid` by value and by reference (see `guids`).
// - `global`: a handle held at module scope, read from a function (`held`).
// - `released`, reported after `run` returns: 9 without a counting provider --
//   the program's reference to each delegate, given back after the `add_`
//   call that was handed it (2 before `elements`); the six `elements` owes
//   whatever the provider: the four `IPropertyValue`s it unboxes -- the ints,
//   the doubles, the strings and the boxed strings -- each released once
//   copied out, and the two boxes it makes, for the doubles and the strings,
//   each given back after the call it was handed to (8 before `filled`); and
//   the reference `distortPoints` is called through, `ICameraIntrinsics2`
//   asked of the camera for the call and given back after it -- and 73
//   under `--rc` (`expected-rc.txt`), those and one for each
//   object handed over, among them: the eleven of `filled` -- the parsed
//   array, its `IVector`, the 9 emptied out of `items`, the two `GetMany`
//   wrote, the query options, their filter, the camera, and the two items
//   the loop reads, each held for its read (61 before `filled`) -- the
//   logging fields `elements` lends its booleans to (72 before them) -- the nine of the `pairs` walk -- the
//   parsed object, its `IIterable`, the iterator, and each pair and the value
//   read from it (46 before the walk) -- the one the
//   `erased` arm's `get` is narrowed back through -- a COM value read out of
//   an erased slot is asked for the interface it is read as, a reference of
//   its own (42 before that) -- the five
//   the `for...of` walk takes -- the parsed array, its `IVector`, and the
//   three values `GetAt` answers (37 before the walk) -- the six
//   releases of `erased`'s one object -- `seven`'s own, `back`'s own, the
//   erased copy `map.set` is passed, the erased value `get` hands back, and
//   the map's entry and the array's element, each given back when its
//   container dies (35 before a container's death released the handles it
//   held erased: `seven` ended with two references nothing gave back),
//   `value`, `list`, `made`, the `Parse("false")`
//   read once and dropped, the languages, the array, its `IVector` and the
//   item read from it, `built`, the number put in it, `built` as its
//   `IJsonValue`, the buffer, the reference, its `IClosable`, and the
//   reference the kept handler captured, released with the closure once the
//   source gave the delegate back (a control whose handler does not capture
//   it measured one fewer), the calendar and the transform. The parse inside the `try` fails, so it hands over
//   nothing and has nothing to give back.
// - `delegates`: how many delegate objects are alive at the end, 0: the
//   removed one was given back by its source at once, the kept one once
//   `remove_Closed` ran. Without that `remove_Closed` it is 1 under both
//   providers -- the handler captures `reference`, which holds the delegate,
//   which holds the handler: the cycle an event handler that captures its
//   source makes in every language with counted references.
import {
  activations,
  asked,
  delegates,
  invoke_elsewhere,
  pending,
  process_cpu_ms,
  quit_message_loop_after,
  releases,
  run_message_loop,
} from "c:report";
// Bound by `nts build` from the Windows Runtime's metadata into `types/winrt`.
import { JsonArray, JsonObject, JsonValue } from "winrt:Windows.Data.Json";
import type { IJsonValue } from "winrt:Windows.Data.Json";
import { CameraIntrinsics } from "winrt:Windows.Media.Devices.Core";
import { QueryOptions } from "winrt:Windows.Storage.Search";
import { local } from "c:memory";
import type { c_int64, c_uint, c_uint32 } from "c:types";
import { GuidHelper, MemoryBuffer, PropertyValue, Uri } from "winrt:Windows.Foundation";
import { LoggingFields } from "winrt:Windows.Foundation.Diagnostics";
import { StringMap } from "winrt:Windows.Foundation.Collections";
import { ThreadPool } from "winrt:Windows.System.Threading";
import { StorageFolder } from "winrt:Windows.Storage";
import { HttpClient } from "winrt:Windows.Web.Http";
import type { IAsyncOperationOfStorageFolder } from "winrt:Windows.Storage";
import type { DateTime } from "winrt:Windows.Foundation";
import { ApplicationLanguages, Calendar } from "winrt:Windows.Globalization";
import { BitmapTransform } from "winrt:Windows.Graphics.Imaging";
import { CryptographicBuffer } from "winrt:Windows.Security.Cryptography";
import { DataReader } from "winrt:Windows.Storage.Streams";
import type { BitmapBounds } from "winrt:Windows.Graphics.Imaging";

// Structs, which cross by value and which the program holds as storage. A
// `DateTime` is eight bytes, which Win64 passes in a register; a
// `BitmapBounds` is sixteen, which it passes as a pointer to a copy. Each
// goes in and comes back through the object: 2021-07-01 set on a calendar
// (the year it reports, whatever the machine's time zone, is 2021) and read
// back a day later as ticks, and bounds put on a transform and read back.
function structs(): string {
  const calendar = new Calendar();
  const moment = local<DateTime>();
  moment[0].universalTime = 132695712000000000n as c_int64;
  calendar.SetDateTime(moment);
  const year = calendar.get_Year();
  calendar.AddDays(1);
  const later = calendar.GetDateTime();
  const days = (later[0].universalTime - moment[0].universalTime) / 864000000000n;
  const transform = new BitmapTransform();
  const bounds = local<BitmapBounds>();
  bounds[0].x = 1 as c_uint32;
  bounds[0].y = 2 as c_uint32;
  bounds[0].width = 300 as c_uint32;
  bounds[0].height = 400 as c_uint32;
  transform.put_Bounds(bounds);
  const back = transform.get_Bounds();
  return String(year) + "+" + String(days) + "d,bounds=" + String(back[0].x) + "," + String(back[0].y) + "," +
    String(back[0].width) + "x" + String(back[0].height);
}

// `[out]` parameters, which a method answers as fields of its result beside
// `returnValue`: `TryParse` on text that parses, whose `result` is the value,
// and on text that does not, which answers `false` and still writes an object
// -- a JSON `null`, which `Stringify` shows as `null` (a C oracle making the
// same call reads `ok=0`, a result of `JsonValueType.Null`); and
// `IndexOf`, a `uint32` beside the `boolean`, on an item the vector holds (the
// object itself, found at 1) and on an equal number that is another object,
// which is not found.
function outs(): string {
  const good = JsonValue.TryParse("7");
  const bad = JsonValue.TryParse("{nope");
  const parsed = good.result === null ? "null" : String(good.result.GetNumber());
  const vector = JsonArray.Parse("[1, 2]").as_IVector();
  const found = vector.IndexOf(vector.GetAt(1));
  const missing = vector.IndexOf(JsonValue.CreateNumberValue(2));
  return String(good.returnValue) + ":" + parsed + "," + String(bad.returnValue) + ":" + (bad.result === null ? "none" : bad.result.Stringify()) +
    ",index=" + String(found.returnValue) + ":" + String(found.index) + "," + String(missing.returnValue);
}

// Byte arrays, a `Uint8Array` borrowed in place with its length before it: a
// buffer made from three bytes (an `[in]` array, which Windows copies) shown
// as hex, which needs the count and the pointer in that order; the bytes read
// back out of it into a `Uint8Array` of the program's (an `[out]` array the
// caller allocates, which Windows fills where it is); and the same bytes
// handed back (a `ReceiveArray`, which Windows allocates: copied into a
// `Uint8Array` of the program's and the block freed).
function bytes(): string {
  const buffer = CryptographicBuffer.CreateFromByteArray(new Uint8Array([1, 2, 255]));
  const back = new Uint8Array(3);
  DataReader.FromBuffer(buffer).ReadBytes(back);
  const received = CryptographicBuffer.CopyToByteArray(buffer).value;
  return CryptographicBuffer.EncodeToHexString(buffer) + ",read=" + String(back[0]) + ":" + String(back[1]) + ":" + String(back[2]) +
    ",received=" + received.join(":") + "/" + String(received.length) + ",elements=" + elements();
}

// Arrays of numbers other than bytes, both ways, as the Windows Runtime's
// JavaScript projection crossed them: an `Int32Array` passed in (its elements
// borrowed in place, `CElements`) and answered as the `IPropertyValue` Windows
// made of it, which unboxes into an `Int32Array` of the program's (a
// `ReceiveArray`, copied, the block freed) -- the element's extremes, so a
// width taken as a byte would show; and a `Float64Array` where an object is
// taken, boxed into an `IPropertyValue` of the array and unboxed the same way.
function elements(): string {
  const ints = PropertyValue.CreateInt32Array(new Int32Array([-7, 65536, 2147483647]));
  const doubles = PropertyValue.CreateInspectable(new Float64Array([0.5, -1e300]));
  // And strings: a `string[]` lent as `HSTRING`s -- the empty one is NULL --
  // and the `IPropertyValue` Windows made of them unboxed into a `string[]`
  // of the program's, each copied and deleted.
  // A `string[]` where an object is taken is boxed the same way.
  const texts = PropertyValue.CreateStringArray(["one", "", "three"]);
  const boxed = PropertyValue.CreateInspectable(["boxed", "too"]);
  // And booleans: a `boolean[]`'s own one-byte elements, lent in place --
  // which a failed call would throw from, and nothing here can read back.
  new LoggingFields().addBooleanArray("flags", [true, false, true]);
  return (ints instanceof Int32Array ? ints.join(":") : "not an Int32Array") + "/" +
    (doubles instanceof Float64Array ? doubles.join(":") : "not a Float64Array") + "/" +
    (Array.isArray(texts) ? texts.join("|") + ":" + String(texts.length) : "not an array") + "/" +
    (Array.isArray(boxed) ? boxed.join("|") : "not an array");
}

// Arrays the callee fills: the program passes one, whose length is how many
// the call may write, and the call writes into it, as `ReadBytes` fills a
// `Uint8Array`. Objects (`GetMany` of an `IVector<IJsonValue>`, from index 1
// of three into three slots): the array's own block lent in place, two
// written. The third held an object; it is emptied before the call and the
// object given back, which only the release count shows (a control without
// the emptying read 71 under rc), since this vector's `GetMany` writes NULL
// into a slot it leaves as well. Strings (`GetMany` of an `IVector<HString>`):
// written into a block of the call's and copied in, replacing what the
// array held. Structs (`DistortPoints`, which with no distortion answers its
// inputs): a block of `Point`s, each copied into a new object.
function filled(): string {
  const vector = JsonArray.Parse("[1, 2, 3]").as_IVector();
  const items: (IJsonValue | null)[] = [null, null, JsonValue.CreateNumberValue(9)];
  const got = vector.GetMany(1, items);
  let objects = String(got);
  for (const item of items) {
    objects += ":" + (item === null ? "null" : String(item.GetNumber()));
  }
  const filter = new QueryOptions().fileTypeFilter;
  filter.append(".txt");
  filter.append(".md");
  const texts = ["old", "old", "old"];
  const written = filter.GetMany(0, texts);
  const camera = new CameraIntrinsics({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0 }, 640, 480);
  const results = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  camera.distortPoints([{ x: 10, y: 20 }, { x: 0.5, y: -3 }], results);
  return objects + "/" + String(written) + ":" + texts.join("|") + "/" +
    String(results[0].x) + "," + String(results[0].y) + ":" + String(results[1].x) + "," + String(results[1].y);
}

// A runtime class whose default interface is an instantiation: `StringMap`
// is `IMap<HString, HString>`, made by its default constructor, which asks
// the object for that interface by the IID computed for the instantiation (a
// wrong one ends the process naming it). Two keys, one replaced -- `insert`
// answers whether it replaced -- and one that is not there. Through the
// instantiation's own surface (`IMapMembers<K, V>`): `size`, `lookup`.
function map(): string {
  const map = new StringMap();
  map.insert("a", "1");
  map.insert("b", "2");
  const replaced = map.insert("a", "3");
  return String(map.size) + ":" + map.lookup("a") + ":" + String(replaced) + ":" + String(map.hasKey("c"));
}

// A COM handle where any value may go -- a `Map` and an `unknown[]` -- as the
// handle tag block carries it: tagged `NTS_TAG_HANDLE_COM`, one reference
// owned by the value and counted through the family `nts_winrt.c` registers.
// Read back it is the same object (`===`), still callable, and `typeof` says
// "object".
function erased(): string {
  const seven = JsonValue.CreateNumberValue(7);
  const byName = new Map<string, JsonValue>();
  byName.set("seven", seven);
  const bag: unknown[] = [seven, 1];
  const back = byName.get("seven");
  return String(back === seven) + ":" + (back === undefined ? "none" : String(back.GetNumber())) + ":" +
    typeof bag[0] + ":" + String(bag[0] === seven);
}

// `Guid`, which `winrt:types` declares and no metadata defines: a new one,
// which is version 4 with RFC 4122's variant -- the variant read out of
// `Data4`, the struct's array field -- the empty one, all zeros, and
// `Equals`, which takes both by reference (`ref const Guid`, a `ConstPtr`
// to the program's storage): a guid equals itself and not the empty one.
function guids(): string {
  const fresh = GuidHelper.CreateNewGuid();
  const empty = GuidHelper.get_Empty();
  const version = fresh[0].Data3 >> 12;
  const variant = (fresh[0].Data4[0] & 0xc0) === 0x80 ? "rfc" : "other";
  const zeros = empty[0].Data1 + empty[0].Data2 + empty[0].Data3 + empty[0].Data4[7];
  return "v" + String(version) + ":" + variant + ",empty=" + String(zeros) + ",equals=" +
    String(GuidHelper.Equals(fresh, fresh)) + ":" + String(GuidHelper.Equals(fresh, empty));
}

// An event: two TypeScript functions handed to `add_Closed` as delegates, one
// removed again, then the reference closed, which raises `Closed` on it before
// the call returns (closing the *buffer* does not: measured with a C oracle
// making the same calls). The kept handler counts itself into a captured
// `let` and reports its `sender`: the reference itself, and its capacity as
// Windows answers it during the event, which is 0 -- the oracle reads 0 there
// too, and 16 before. The removed one would count 100. `alive` is how many
// delegate objects exist while the event source holds the kept one.
function events(): string {
  let seen = 0;
  let sender = "none";
  const buffer = new MemoryBuffer(16);
  const reference = buffer.CreateReference();
  const kept = reference.add_Closed((from) => {
    seen += 1;
    sender = (from === reference ? "reference" : "other") + ":" + String(from.get_Capacity());
  });
  const dropped = reference.add_Closed(() => {
    seen += 100;
  });
  reference.remove_Closed(dropped);
  const alive = delegates();
  reference.as_IClosable().Close();
  reference.remove_Closed(kept);
  return String(seen) + ",sender=" + sender + ",alive=" + String(alive) + ",tokens=" + (kept === dropped ? "same" : "distinct");
}

// Run as `winrt throw`: a delegate whose function throws. A switch on the
// command line and not a second entry, because an executable evaluates every
// module its tsconfig includes rather than its entry's imports (node runs only
// those): a `src/throws.ts` beside this ran after it in the same program. A
// known defect, MainClaude's to fix; this becomes a second entry once it is.
// `Invoke` has an
// HRESULT to answer and the throw is not delivered as one -- the event
// source's frames stand between it and any `catch` outside the handler, and
// a non-local jump past them would skip what they hold. So the process ends,
// naming the boundary and the message, and the source never gets an answer:
// never S_OK for a handler that failed. `after` never prints.
function throwing(): void {
  const reference = new MemoryBuffer(4).CreateReference();
  reference.add_Closed(() => {
    throw new Error("the handler failed");
  });
  console.log("before");
  reference.as_IClosable().Close();
  console.log("after");
}

// A handle at module scope: a global the module's initializer assigns and a
// function reads. Under `--rc` it is held until the process ends, and each
// read takes a reference and gives it back.
const held = JsonValue.Parse("7");

function run(): string {
  const value = JsonValue.Parse("42.5");
  const number = value.GetNumber();
  const text = value.Stringify();
  const list = JsonValue.Parse("[1, 2.5, true]");
  const made = JsonValue.CreateBooleanValue(true);
  const bools = made.Stringify() + "," + String(made.GetBoolean()) + "," + String(JsonValue.Parse("false").GetBoolean());
  const languages = ApplicationLanguages.languages;
  const first = languages.getAt(0);
  const tags = (languages.size >= 1 ? "some" : "none") + "," + (first.includes("-") ? "tagged" : first);
  const vector = JsonArray.Parse("[1, 2.5, true]").as_IVector();
  // Walked by `for...of`, as an array is: `GetAt(i)` while `i < get_Size()`.
  let total = 0;
  for (const value of JsonArray.Parse("[1, 2.5, 4]").as_IVector()) {
    total += value.GetNumber();
  }
  // Any other iterable walked by the iterator its `First` makes --
  // `get_Current`, then `MoveNext` -- as C# walks one: an object's pairs.
  // Sorted, since a map's order is its own.
  const keys: string[] = [];
  let sum = 0;
  for (const pair of JsonObject.Parse('{"b": 2, "a": 1, "c": 4}').as_IIterable()) {
    keys.push(pair.get_Key());
    sum += pair.get_Value().GetNumber();
  }
  keys.sort();
  const items = String(vector.size) + ":" + String(vector.getAt(1).GetNumber()) + ":" + String(total) +
    ",pairs=" + keys.join("") + ":" + String(sum);
  // A sealed class constructed as the JavaScript projection wrote one: by
  // its default activation (`new JsonObject()`), and by the activation
  // factory's method the arguments choose (`new Uri(base, relative)` is
  // `CreateWithRelativeUri`).
  const built = new JsonObject();
  built.SetNamedValue("x", JsonValue.CreateNumberValue(3));
  const shown = built.as_IJsonValue().Stringify() + "," + new Uri("https://example.com/docs/", "page").absoluteUri;
  let threw = "nothing";
  try {
    JsonValue.Parse("{not json");
  } catch (error) {
    threw = (error instanceof Error ? error.message : "not an Error").slice(0, 18);
  }
  return "number=" + String(number) + " text=" + text + " list=" + list.Stringify() + " activations=" +
    String(activations()) + " bools=" + bools + " languages=" + tags + " vector=" + items + " built=" + shown + " threw=" + threw +
    " closed=" + events() + " structs=" + structs() + " outs=" + outs() + " bytes=" + bytes() + " filled=" + filled() + " map=" + map() + " erased=" + erased() + " guids=" + guids() + " global=" + String(held.GetNumber());
}

if (asked("throw")) {
  throwing();
}
// Run as `winrt thread`: a delegate called on a thread the program does not
// own, and released there last. The delegate is agile, so a source calls it
// wherever it completes; the call is carried to this thread, with `sender`
// held across, and so is the release -- `delegates=0` once both have run.
// Before, each ended the process by name.
function threaded(): void {
  invoke_elsewhere((sender) => {
    console.log("carried " + String(sender.GetNumber()));
  }, JsonValue.Parse("7"));
  console.log("returned");
  setTimeout(() => {
    console.log("delegates=" + String(delegates()));
  }, 1000);
}

// Run as `winrt async`: Windows Runtime async work awaited as itself, as C#
// awaits it. Each operation and action's binding declares `then`, which
// subscribes `Completed` from the thread pool, carried here: outstanding
// (`nts_pending_begin`) from the subscription to the completion, which keeps
// the program running until then. The handler reads the object it is given
// rather than capturing it -- the object holds the handler, and a capture
// would make a cycle -- and decides by the status it is handed.
// A work item handed to the thread pool runs here, carried, and so after
// its action has completed -- WinRT counts it done when its `Invoke`
// returns -- which is why nothing here reads what it did. The second
// `put_Completed` on one action is refused (E_ILLEGAL_DELEGATE_ASSIGNMENT):
// a start that fails, whose operation must not stay outstanding.
// What awaiting an operation rejects with, or "resolved".
async function failure(operation: IAsyncOperationOfStorageFolder): Promise<string> {
  try {
    await operation;
    return "resolved";
  } catch (error) {
    return (error instanceof Error ? error.message : "not an Error").slice(0, 18);
  }
}

async function awaited(): Promise<string> {
  const run = ThreadPool.RunAsync(() => {});
  await run;
  const status = run.as_IAsyncInfo().get_Status();
  const action = ThreadPool.RunAsync(() => {});
  action.put_Completed(() => {});
  let refused = "nothing";
  try {
    await action;
  } catch (error) {
    refused = (error instanceof Error ? error.message : "not an Error").slice(0, 18);
  }
  // The operation itself, awaited: its binding declares `then`, which
  // subscribes `Completed` as the specification resolves any thenable. It
  // stays an operation, so afterwards it still answers its `IAsyncInfo`.
  const operation = StorageFolder.GetFolderFromPathAsync("C:\\Windows");
  const folder = await operation;
  const completed = operation.as_IAsyncInfo().get_Status();
  // A second `await` subscribes `Completed` again, which the operation
  // refuses (E_ILLEGAL_DELEGATE_ASSIGNMENT), so it rejects with that; and an
  // operation that fails rejects with its own error.
  const again = await failure(operation);
  const missing = await failure(StorageFolder.GetFolderFromPathAsync("C:\\nts-no-such-folder"));
  // An HTTP operation, which reports progress as `HttpProgress` -- a struct
  // holding objects, which awaiting reads none of -- asked of a host that
  // never resolves (`.invalid`), so it rejects without a network.
  let http = "resolved";
  try {
    await new HttpClient().getStringAsync(new Uri("https://nts.invalid/"));
  } catch (error) {
    http = error instanceof Error ? "rejected" : "not an Error";
  }
  return "status=" + String(status) + " refused=" + refused + " folder=" + folder.as_IStorageItem().get_Name() +
    " completed=" + String(completed) + " again=" + again + " missing=" + missing + " http=" + http + " pending=" + String(pending());
}

async function reportAwaited(): Promise<void> {
  console.log(await awaited());
}

// Run as `winrt pumped`: the same carried call, inside a Win32 message loop
// with nothing else of libuv's alive -- no timer, nothing awaited -- which a
// Win32 timer leaves after two seconds. The pump drains the carried call
// itself, so the handler runs either way; what the loop's idle time shows is
// whether the pump's libuv turn consumed the cross-thread packet. One that
// did not poll left it on the completion port, and the watcher took it off,
// put it back and woke the pump again, for as long as the loop ran: a spin,
// with nothing else wrong (the lost wakeup Apple fixed in 238d1f8b, as it
// shows on Windows). So the loop's CPU time is the measurement: a few
// milliseconds idle, against the whole two seconds spinning.
function pumped(): void {
  invoke_elsewhere((sender) => {
    console.log("carried " + String(sender.GetNumber()));
  }, JsonValue.Parse("7"));
  quit_message_loop_after(2000 as c_uint);
  const before = process_cpu_ms();
  run_message_loop();
  const spent = process_cpu_ms() - before;
  console.log("left the loop, " + (spent < 500 ? "idle" : "spinning: " + String(Math.round(spent)) + " ms"));
}

if (asked("pumped")) {
  pumped();
} else if (asked("async")) {
  void reportAwaited();
} else if (asked("thread")) {
  threaded();
} else {
  const line = run();
  console.log(line + " released=" + String(releases()) + " delegates=" + String(delegates()));
}
