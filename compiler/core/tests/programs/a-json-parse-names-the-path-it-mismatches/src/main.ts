// A typed `JSON.parse`'s errors as nts writes them, which node, whose `as`
// checks nothing, cannot be the oracle for: the `TypeError` names the JSON
// path and what was expected there, and invalid text is still V8's
// `SyntaxError` first. `read` throws through a call, so a caller's handler
// must catch what a helper's parse raises. Run by
// `compiler/codegen/c/tests/execute.rs`.
interface Tag {
  "odd key": number;
}
interface Row {
  id: number;
  name: string | null;
  tags: string[];
  inner: { ok: boolean; tag?: Tag };
}


function read(text: string): Row {
  return JSON.parse(text) as Row;
}

export function report(n: number): number {
  // Inside the function: the C harness calls exports without module evaluation.
  const TEXTS = [
    '{"id":1,"name":null,"tags":["a"],"inner":{"ok":true}}',
    '{"id":"one","name":"a","tags":[],"inner":{"ok":true}}',
    '{"id":1,"name":2,"tags":[],"inner":{"ok":true}}',
    '{"id":1,"name":"a","tags":["a",3],"inner":{"ok":true}}',
    '{"id":1,"name":"a","tags":[],"inner":{"tag":{"odd key":"x"},"ok":false}}',
    '{"id":1,"name":"a","tags":[],"inner":{}}',
    '{"id":1,"name":"a","tags":[]}',
    '[{"id":1}]',
    '{"id":"one","name":"a","tags":[],"inner":{"ok":true}',
  ];
  try {
    const row = read(TEXTS[n]);
    console.log("parsed " + row.id + " " + (row.name === null) + " " + row.tags.length + " " + row.inner.ok);
  } catch (error) {
    if (error instanceof TypeError) console.log("TypeError: " + error.message);
    else if (error instanceof SyntaxError) console.log("SyntaxError: " + error.message);
    else console.log("other");
  }
  return n;
}
