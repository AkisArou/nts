// A typed `JSON.parse` in a program whose arrays grow: the `push` below puts
// every `number[]` behind an `NtsArrayD` on the JVM, the tape included, so the
// scan answers `NtsJson.tapeArray` and every read takes that form. Its twin,
// `compiler/core/tests/programs/a-json-parse-names-the-path-it-mismatches`,
// grows no array and runs the bare `double[]` form. Run by `execute.rs`.
interface Row {
  id: number;
  tags: string[];
  inner: { ok: boolean };
}

export function report(n: number): number {
  const texts: string[] = [];
  texts.push('{"id":1,"tags":["a","b"],"inner":{"ok":true}}');
  texts.push('{"id":1,"tags":["a",3],"inner":{"ok":true}}');
  texts.push('{"id":1,"tags":[],"inner":{}}');
  texts.push('{"id":1,"tags":[] "inner":{}}');
  // An escaped key, which the key read decodes before it compares.
  texts.push('{"i\\u0064":2,"tags":["\\u00e9"],"inner":{"ok":false}}');
  try {
    const row = JSON.parse(texts[n]) as Row;
    console.log("parsed " + row.id + " " + row.tags.join(",") + " " + row.inner.ok);
  } catch (error) {
    if (error instanceof TypeError) console.log("TypeError: " + error.message);
    else if (error instanceof SyntaxError) console.log("SyntaxError: " + error.message);
    else console.log("other");
  }
  return n;
}
