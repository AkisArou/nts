// run: check
// backend: jvm

// #209: a narrower return signature hides an optional fixed parameter and rest.
// The control differs only in Reader's exposed signature.
type Value = number | string | boolean | null | undefined | { mark: number };
interface Result { first: Value; second: Value; tail: Value[]; }
type Reader = (first?: Value) => Result;
function declared(first?: Value, second?: Value, ...tail: Value[]): Result {
  return { first, second, tail };
}
const expression = function(first?: Value, second?: Value, ...tail: Value[]): Result {
  return { first, second, tail };
};
function choose(alternate: boolean): Reader { return alternate ? expression : declared; }
function invoke(reader: Reader, input: [Value?]): Result { return reader(...input); }
export function through(n: number): boolean {
  const reader = choose(n < 0);
  const identity = { mark: 23 };
  const inputs: [Value?][] = [[], [undefined], [null], [-0], [NaN], [identity]];
  for (const input of inputs) {
    const first = invoke(reader, input), second = invoke(reader, input);
    const omitted = invoke(reader, []);
    if (first.second !== undefined || second.second !== undefined || omitted.second !== undefined) return false;
    if (first.tail.length !== 0 || second.tail.length !== 0 || omitted.tail.length !== 0) return false;
    if (first.tail === second.tail || first.tail === omitted.tail || second.tail === omitted.tail) return false;
    const written = first.tail.push(42);
    if (!Object.is(first.first, input[0]) || !Object.is(second.first, input[0])
      || omitted.first !== undefined || written !== 1 || first.tail[0] !== 42
      || second.tail.length !== 0 || omitted.tail.length !== 0) return false;
  }
  return true;
}
