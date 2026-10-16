// A loop's trip count bounds what it adds up, however its steps arrive.
//
// `hir::loops` bounds an accumulator by how many times its loop can run. It
// read a step only as one constant reached through at most three merges, on a
// loop with one back edge. Real loops are not written that way. `utf8Length`
// steps its count by 1, 2, 3 or 4 down a four-arm `else if` chain and its
// index by one or two, so it got no trip count, its count had no bound and
// stayed a double -- and so did every index derived from it in `utf8Write`
// and `utf8Decode`, which is most of why `node-utf8` lost to node.
//
// A step is now a range, followed through any chain of merges and joined over
// every back edge. `byteLength` is that loop. `nonSpaces` has two back edges,
// its `continue` and the end of its body. `longestRun`'s count is an inner
// loop's, and an inner loop had no trip count at all: a back edge was "the
// header can reach the source", which inside an outer loop is true of the
// inner loop's entry too. The control is the first loop with one arm's step
// unbounded: `weighedLength` adds a caller's number where `byteLength` adds
// 4, so its count can pass 2^53 and stays a double.
//
// expect-ir: all: byteLength returns integer
// expect-ir: all: nonSpaces returns integer
// expect-ir: all: longestRun returns integer
// expect-ir: all: weighedLength returns float

function byteLength(input: string): number {
  let length = 0;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code < 0x80) {
      length++;
    } else if (code < 0x800) {
      length += 2;
    } else if (code >= 0xd800 && code < 0xdc00 && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        length += 4;
        index++;
        continue;
      }
      length += 3;
    } else {
      length += 3;
    }
  }
  return length;
}

function weighedLength(input: string, weight: number): number {
  let length = 0;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code < 0x80) {
      length++;
    } else if (code < 0x800) {
      length += 2;
    } else if (code >= 0xd800 && code < 0xdc00 && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        length += weight;
        index++;
        continue;
      }
      length += 3;
    } else {
      length += 3;
    }
  }
  return length;
}

function nonSpaces(text: string): number {
  let index = 0;
  let count = 0;
  while (index < text.length) {
    if (text.charCodeAt(index) === 32) {
      index++;
      continue;
    }
    count++;
    index++;
  }
  return count;
}

function longestRun(text: string): number {
  let best = 0;
  for (let i = 0; i < text.length; i++) {
    let run = 0;
    for (let j = i; j < text.length; j++) {
      if (text.charCodeAt(j) !== text.charCodeAt(i)) break;
      run++;
    }
    if (run > best) best = run;
  }
  return best;
}

// The facts are the inner functions'; an export keeps a double at its boundary.
export function lengthOf(text: string): number {
  return byteLength(text);
}

export function weighed(text: string, weight: number): number {
  return weighedLength(text, weight);
}

export function letters(text: string): number {
  return nonSpaces(text);
}

export function run(text: string): number {
  return longestRun(text);
}

console.log(lengthOf("héllo 你好 😀"), lengthOf("abc"));
console.log(weighed("a😀", 1e300), weighed("éé", 5));
console.log(letters("a b  c "), letters(""));
console.log(run("abbbcc"), run(""), run("\ud83d\ude00\ud83d\ude00"));
