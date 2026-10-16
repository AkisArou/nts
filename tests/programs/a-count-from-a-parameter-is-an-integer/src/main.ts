// A loop count that starts at a parameter is an integer of its own width.
//
// Specialization makes a block parameter and every value passed to it one
// class, and a class with an already-integer member may only be that member's
// width. A function parameter narrowed by `signatures` is such a member. So
// `let at = offset` before a loop that adds to `at` made the count `offset`'s
// width or nothing: `offset` is an `i32`, the count can pass 2^31 and needs
// 64 bits, the class disagreed with its pinned member and stayed a double.
// That was `utf8Write`'s output position, converted on every byte it wrote.
//
// A comparison already does not join a parameter, for the same reason: its
// representation is the signature and can only drag the other side down. An
// edge now does not either; the block parameter takes its own width and the
// edge converts. The control starts the same count at a constant, which was
// never pinned and is an integer either way.
//
// expect-ir: all: block params in fromOffset are integer
// expect-ir: all: block params in fromZero are integer

function fromOffset(text: string, offset: number): number {
  let at = offset;
  for (let i = 0; i < text.length; i++) {
    at += (text.charCodeAt(i) & 3) + 1;
  }
  return at - offset;
}

function fromZero(text: string): number {
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    at += (text.charCodeAt(i) & 3) + 1;
  }
  return at;
}

export function counted(text: string): number {
  return fromOffset(text, 7) + fromZero(text);
}

console.log(counted("abc\u00e9 z"), counted(""));
