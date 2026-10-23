// A chain's first link is made with room (`nts_str_concat_grown`), and the
// appends after it write there until it is full. Then one grows it, and the
// first link's string is given back exactly once.
//
// `${name}:${i},${tag}`: `name + ":"` is read only by the number's append, so
// it is made with room for its power of two. "abcde:" is six units in room for
// eight, and its digit and comma fill it exactly, with nothing after them.
// "cdefghijk:" is ten in room for sixteen; its tag is too long for what is
// left, so the last append grows it and gives the first link back.

const NAMES = ["abcde", "cdefghijk"];
const TAGS = ["", "a-tag-too-long-for-the-room"];

export function work(seed: number): number {
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const j = (seed + i) & 1;
    const text = `${NAMES[j]!}:${i},${TAGS[j]!}`;
    total = total * 31 + text.length + text.charCodeAt(text.length - 1);
  }
  return total;
}
