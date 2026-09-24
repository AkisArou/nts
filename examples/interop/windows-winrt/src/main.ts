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
// - `threw`: an HRESULT failure, thrown as an `Error` naming the code.
// - `released`, reported after `run` returns: 0 without a counting provider,
//   and 4 under `--rc`, one for each object handed over: `value`, `list`,
//   `made`, and the `Parse("false")` read once and dropped. The parse
//   inside the `try` fails, so it hands over nothing and has nothing to give
//   back; a release there would be of an object that does not exist.
import { activations, releases, report } from "c:report";
// Bound by `nts build` from the Windows Runtime's metadata into `types/winrt`.
import { JsonValue } from "winrt:Windows.Data.Json";

function run(): string {
  const value = JsonValue.Parse("42.5");
  const number = value.GetNumber();
  const text = value.Stringify();
  const list = JsonValue.Parse("[1, 2.5, true]");
  const made = JsonValue.CreateBooleanValue(true);
  const bools = made.Stringify() + "," + String(made.GetBoolean()) + "," + String(JsonValue.Parse("false").GetBoolean());
  let threw = "nothing";
  try {
    JsonValue.Parse("{not json");
  } catch (error) {
    threw = (error as Error).message.slice(0, 18);
  }
  return "number=" + String(number) + " text=" + text + " list=" + list.Stringify() + " activations=" +
    String(activations()) + " bools=" + bools + " threw=" + threw;
}

const line = run();
report(line + " released=" + String(releases()));
