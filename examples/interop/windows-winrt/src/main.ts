// The Windows Runtime from TypeScript: `Windows.Data.Json`, which needs no
// window and no package identity, called through COM vtables.
//
// Each value reported depends on one part working:
// - `number` and `text`: `Parse` is a static, called on the class's cached
//   activation factory with an HSTRING argument; `GetNumber` writes a double
//   through its result slot, `Stringify` an HSTRING copied into a `string`.
// - `activations=1` after three parses: the factory cache hit. A cache that
//   never hit would answer the same values and count 3.
// - `threw`: an HRESULT failure, thrown as an `Error` naming the code.
// - `released`, reported after `run` returns: 0 without a counting provider,
//   and 2 under `--rc`, one for each object `Parse` handed over. The parse
//   inside the `try` fails, so it hands over nothing and has nothing to give
//   back; a release there would be of an object that does not exist.
import { activations, releases, report } from "c:report";
import { Parse } from "winrt:Windows.Data.Json";

function run(): string {
  const value = Parse("42.5");
  const number = value.GetNumber();
  const text = value.Stringify();
  const list = Parse("[1, 2.5, true]");
  let threw = "nothing";
  try {
    Parse("{not json");
  } catch (error) {
    threw = (error as Error).message.slice(0, 18);
  }
  return "number=" + String(number) + " text=" + text + " list=" + list.Stringify() + " activations=" +
    String(activations()) + " threw=" + threw;
}

const line = run();
report(line + " released=" + String(releases()));
