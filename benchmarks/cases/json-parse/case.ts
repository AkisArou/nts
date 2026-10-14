// A whole document parsed, which until tonight could not be measured at all.
//
// **This row exists because a refusal moved.** `json-scan` and
// `json-stringify-doc` both say, in their own comments, that the parse direction does not
// compile -- `numberValueOf` ends in `Number(text)`, which blocked `Scanner#readNumber`,
// `readValue` and `parseJsonText`, so the parser had no presence on the compiled axis and there
// was no parse row in this table. `Number(string)` landed, and underneath it was a second
// blocker nobody had seen: `json/parse.ts` and `json/stringify.ts` each declare a class called
// `Frame`, and a constructor call was named from the *source text of the identifier*, so the
// call said `Frame#constructor` where the definition said `Frame@parse#constructor` and the
// caller was dropped as calling something refused. Nothing was refused. Both are fixed and the
// whole chain compiles.
//
// So the honest framing of this row is that it measures a thing that has never been measured,
// not that it measures a thing that got faster.
//
// **The document is the serializer's**, built as text rather than as a graph so that the two
// directions are the same bytes: `json-stringify-doc` turns a `JsonValue` into this string and
// this turns the string back. A parse corpus that shared no shape with the serialize corpus
// would make the pair look comparable and not be.
//
// Weighted the way documents are, and deliberately not the way a grammar is: mostly small
// integers and short ASCII keys, with a few strings needing escapes and a few fractions. A
// corpus of exponents and escape-heavy strings measures the fallbacks and reports them as the
// common case, which is the mistake `json-scan`'s comment names about its own input.
//
// **There is no `ref.cpp`.** A hand-written C++ JSON parser is a different program -- simdjson
// is 5.6x off node's own parser precisely because it is a different program -- and this row is
// asking what this compiler does with the parser we ship. `native.mjs` beside
// `json-stringify-doc` answers the other question for the other direction, and the equivalent
// for this one is `JSON.parse` on the host, which the `V8` and `Bun` columns do not measure
// because they run our TypeScript. That gap is stated rather than closed here.
import { parseJsonText } from "../../../runtime/web-platform/src/json/parse.ts";

function source(): string {
  const rows: string[] = [];
  for (let index = 0; index < 2000; index++) {
    const escaped = index % 37 === 0 ? '"a\\"b\\n"' : '"row' + index + '"';
    rows.push(
      '{"id":' +
        index +
        ',"name":' +
        escaped +
        ',"ok":' +
        (index % 2 === 0 ? "true" : "false") +
        ',"score":' +
        (index % 5 === 0 ? "1.5e2" : String(index)) +
        ',"tags":["a","b"]}',
    );
  }
  return '{"rows":[' + rows.join(",") + '],"count":2000,"note":null}';
}

const SOURCE = source();

export function work(iterations: number): number {
  let total = 0;
  for (let round = 0; round < iterations; round++) {
    const parsed = parseJsonText(SOURCE);
    // The top-level member count, which is three. Enough to keep the parse
    // observed and small enough that the row is the parse rather than a walk
    // of what it produced.
    total = total + parsed.values.length;
  }
  return total;
}

/**
 * One parse per op, so this row's microseconds convert directly to milliseconds per parse the
 * way `json-stringify-doc`'s do.
 *
 * `volatile` in every generated driver, for the reason `node-utf8` gives: a loop-invariant
 * argument lets the optimiser hoist the whole call out of the timed region and report a zero.
 */
export const seed = 1;
