// expect: NTS1001 `Date.now`, which reads a clock
//
// `Date.now()` is refused: the compiler has no clock capability. Every
// function that calls it -- or calls something that calls it -- is
// refused with it, so one call removes a whole cone of callers.
//
// The control is `fixed` below: a function returning a constant lowers
// cleanly. The pair differs in one thing -- the clock read -- so the
// refusal is the capability, not the function shape around it.
//
// This is the terminal refusal behind `http`'s `createServer` (the
// largest single group on the compiled axis: 274 of http's 407 failing
// files first fail at `createServer is not a function`), whose chain
// runs createServer -> Server constructor -> `Date.now`, and it also
// appears in `fs`'s cone. Node's HTTP server stamps its requests from
// the clock; there is no way to write that module differently and keep
// node's behaviour (measured on main e0b77e5a7, slice 2).

// Refused: reads a clock.
export function now(): number {
  return Date.now();
}

// Control: lowers.
export function fixed(): number {
  return 42;
}
