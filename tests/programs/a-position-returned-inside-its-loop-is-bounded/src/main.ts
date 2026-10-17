// A position returned from inside its loop is bounded by the loop's guard.
//
// The whole-program analysis gives a function's result the join of what it
// returns, and it took each returned value's fact where the value is defined.
// A scan's position is a loop counter, which is `[from, +inf]` there. But the
// scan returns it from inside the loop, under the `at < text.length` that kept
// the loop going, where it is `[from, length - 1]`. So the caller's next
// start, `found + 1`, was not provably an `int32`: `nextComma`'s parameter
// stayed a double, and its loop counted in floating point. That was
// `firstEscapeIndex` in the JSON serializer, a fifth of `json-build-append`.
//
// A result is now worth what is known where it is returned, as an argument is
// worth what is known where the call happens. The control, `firstComma`, is
// the same scan whose callers pass only constants: nothing it returns comes
// back to it, so its parameter was an integer either way.
//
// expect-ir: all: nextComma param from is i32
// expect-ir: all: block params in nextComma are integer
// expect-ir: all: firstComma param from is i32

function nextComma(text: string, from: number): number {
  for (let at = from; at < text.length; at++) {
    if (text.charCodeAt(at) === 44) return at;
  }
  return -1;
}

function commas(text: string): number {
  let count = 0;
  let at = nextComma(text, 0);
  while (at >= 0) {
    count += at;
    at = nextComma(text, at + 1);
  }
  return count;
}

function firstComma(text: string, from: number): number {
  for (let at = from; at < text.length; at++) {
    if (text.charCodeAt(at) === 44) return at;
  }
  return -1;
}

export function scanned(text: string): number {
  return commas(text) + firstComma(text, 0) * 1000 + firstComma(text, 3) * 1000000;
}

console.log(scanned(""), scanned(","), scanned("a,b,,c"), scanned("ends,"), scanned("wide \u{1F600},\u00e9,"));
