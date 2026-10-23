// A property whose name holds `"` and `\`: the C backend spells the struct
// member `_x..` (`c_member_escaped`), and its layout check's message names the
// field inside a C string literal, which has to escape both. Unescaped, the
// emitted C did not compile. The `plain` export is the control: the same
// shape with ordinary names.

interface Quoted {
  "say \"hi\"": number;
  "back\\slash": number;
  plain: number;
}

interface Plain {
  first: number;
  second: number;
  plain: number;
}

export function quoted(seed: number): number {
  const q: Quoted = { "say \"hi\"": seed, "back\\slash": seed * 2, plain: 3 };
  q["back\\slash"] += 1;
  return q["say \"hi\""] + q["back\\slash"] + q.plain;
}

export function plain(seed: number): number {
  const p: Plain = { first: seed, second: seed * 2, plain: 3 };
  p.second += 1;
  return p.first + p.second + p.plain;
}

console.log(quoted(1), plain(1));
