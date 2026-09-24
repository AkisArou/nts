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
// - `released`, reported after `run` returns: 2 without a counting provider --
//   the program's reference to each delegate, given back after the `add_`
//   call that was handed it -- and 17 under `--rc`, those two and one for
//   each object handed over: `value`, `list`, `made`, the `Parse("false")`
//   read once and dropped, the languages, the array, its `IVector` and the
//   item read from it, `built`, the number put in it, `built` as its
//   `IJsonValue`, the buffer, the reference, its `IClosable`, and the
//   reference the kept handler captured, released with the closure once the
//   source gave the delegate back (a control whose handler does not capture
//   it measured 16). The parse inside the `try` fails, so it hands over
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
import { MemoryBuffer } from "winrt:Windows.Foundation";
import { ApplicationLanguages } from "winrt:Windows.Globalization";

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

// Run as `winrt throw`: a delegate whose function throws. `Invoke` has an
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
    " closed=" + events();
}

if (asked("throw")) {
  throwing();
}
const line = run();
report(line + " released=" + String(releases()) + " delegates=" + String(delegates()));
