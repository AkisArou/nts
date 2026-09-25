// The Windows Runtime from TypeScript: `Windows.Data.Json`, which needs no
// window and no package identity, called through COM vtables.
//
// Each value reported depends on one part working:
// - `number` and `text`: `JsonValue.Parse` is a static, called on the
//   class's cached activation factory with an HSTRING argument; `GetNumber` writes a double
//   through its result slot, `Stringify` an HSTRING copied into a `string`.
// - `activations=1` after three parses: the factory cache hit. A cache that
//   never hit would answer the same values and count 3.
// - `bools`: a `boolean` both ways -- passed to `CreateBooleanValue` (which
//   `Stringify` then shows) and read back from `GetBoolean`, one byte each.
// - `languages`: a generic interface, `IVectorView<HString>` from
//   `Windows.Globalization` -- `get_Size` and `GetAt` through the table of the
//   instantiation the static handed back, whatever `T` it was made for. What
//   the machine's languages are is its own, so the line says only that there
//   is one and that the first is a BCP-47 tag.
// - `vector`: a class's other interface, by `QueryInterface` with the IID the
//   Windows Runtime computes for `IVector<IJsonValue>` -- `as_IVector` on a
//   `JsonArray`, whose own interface is `IJsonArray`. A wrong IID ends the
//   process naming it rather than printing anything.
// - `built`: a runtime class made by its default constructor
//   (`JsonObject.create()`, `ActivateInstance` then its default interface),
//   filled, and read back through another of its interfaces.
// - `threw`: an HRESULT failure, thrown as an `Error` naming the code.
// - `closed`: an event, a TypeScript function as a delegate (see `events`).
// - `structs`: records by value, both sizes Win64 passes (see `structs`).
// - `outs`: `[out]` parameters, as fields of the result (see `outs`).
// - `bytes`: byte arrays both ways (see `bytes`).
// - `map`: a class whose default interface is an instantiation (see `map`).
// - `guids`: `Guid` by value and by reference (see `guids`).
// - `global`: a handle held at module scope, read from a function (`held`).
// - `released`, reported after `run` returns: 2 without a counting provider --
//   the program's reference to each delegate, given back after the `add_`
//   call that was handed it -- and 19 under `--rc`, those two and one for
//   each object handed over: `value`, `list`, `made`, the `Parse("false")`
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
import { activations, asked, delegates, releases, report } from "c:report";
// Bound by `nts build` from the Windows Runtime's metadata into `types/winrt`.
import { JsonArray, JsonObject, JsonValue } from "winrt:Windows.Data.Json";
import { local } from "c:memory";
import type { c_int64, c_uint32 } from "c:types";
import { GuidHelper, MemoryBuffer } from "winrt:Windows.Foundation";
import { StringMap } from "winrt:Windows.Foundation.Collections";
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
  const calendar = Calendar.create();
  const moment = local<DateTime>();
  moment[0].UniversalTime = 132695712000000000n as c_int64;
  calendar.SetDateTime(moment);
  const year = calendar.get_Year();
  calendar.AddDays(1);
  const later = calendar.GetDateTime();
  const days = (later[0].UniversalTime - moment[0].UniversalTime) / 864000000000n;
  const transform = BitmapTransform.create();
  const bounds = local<BitmapBounds>();
  bounds[0].X = 1 as c_uint32;
  bounds[0].Y = 2 as c_uint32;
  bounds[0].Width = 300 as c_uint32;
  bounds[0].Height = 400 as c_uint32;
  transform.put_Bounds(bounds);
  const back = transform.get_Bounds();
  return String(year) + "+" + String(days) + "d,bounds=" + String(back[0].X) + "," + String(back[0].Y) + "," +
    String(back[0].Width) + "x" + String(back[0].Height);
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
// as hex, which needs the count and the pointer in that order; and the bytes
// read back out of it into a `Uint8Array` of the program's (an `[out]` array
// the caller allocates, which Windows fills where it is).
function bytes(): string {
  const buffer = CryptographicBuffer.CreateFromByteArray(new Uint8Array([1, 2, 255]));
  const back = new Uint8Array(3);
  DataReader.FromBuffer(buffer).ReadBytes(back);
  return CryptographicBuffer.EncodeToHexString(buffer) + ",read=" + String(back[0]) + ":" + String(back[1]) + ":" + String(back[2]);
}

// A runtime class whose default interface is an instantiation: `StringMap`
// is `IMap<HString, HString>`, made by its default constructor, which asks
// the object for that interface by the IID computed for the instantiation (a
// wrong one ends the process naming it). Two keys, one replaced -- `Insert`
// answers whether it replaced -- and one that is not there.
function map(): string {
  const map = StringMap.create();
  map.Insert("a", "1");
  map.Insert("b", "2");
  const replaced = map.Insert("a", "3");
  return String(map.get_Size()) + ":" + map.Lookup("a") + ":" + String(replaced) + ":" + String(map.HasKey("c"));
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
  const buffer = MemoryBuffer.Create(16);
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
  const reference = MemoryBuffer.Create(4).CreateReference();
  reference.add_Closed(() => {
    throw new Error("the handler failed");
  });
  report("before");
  reference.as_IClosable().Close();
  report("after");
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
  const languages = ApplicationLanguages.get_Languages();
  const first = languages.GetAt(0);
  const tags = (languages.get_Size() >= 1 ? "some" : "none") + "," + (first.includes("-") ? "tagged" : first);
  const vector = JsonArray.Parse("[1, 2.5, true]").as_IVector();
  const items = String(vector.get_Size()) + ":" + String(vector.GetAt(1).GetNumber());
  const built = JsonObject.create();
  built.SetNamedValue("x", JsonValue.CreateNumberValue(3));
  const shown = built.as_IJsonValue().Stringify();
  let threw = "nothing";
  try {
    JsonValue.Parse("{not json");
  } catch (error) {
    threw = (error as Error).message.slice(0, 18);
  }
  return "number=" + String(number) + " text=" + text + " list=" + list.Stringify() + " activations=" +
    String(activations()) + " bools=" + bools + " languages=" + tags + " vector=" + items + " built=" + shown + " threw=" + threw +
    " closed=" + events() + " structs=" + structs() + " outs=" + outs() + " bytes=" + bytes() + " map=" + map() + " guids=" + guids() + " global=" + String(held.GetNumber());
}

if (asked("throw")) {
  throwing();
}
const line = run();
report(line + " released=" + String(releases()) + " delegates=" + String(delegates()));
