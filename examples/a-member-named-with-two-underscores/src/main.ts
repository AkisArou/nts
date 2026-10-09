// A member whose name starts with two underscores, of type `unknown`, read
// beside a plain one. Filed from the React lane as a blocker: renamed
// `_snapshot`, the same program compiled, because TypeScript escapes the name
// (`___snapshot`) in its tables and the compiler matched the escaped spelling.
// Every name now reaches the compiler as the program wrote it (`written_name`);
// `examples/a-field-whose-name-starts-with-two-underscores` has the wider set.

class Holder {
  __snapshot: unknown = undefined;
  plain: unknown = undefined;
}

function read(holder: Holder): string {
  return String(holder.__snapshot === undefined) + String(holder.plain === undefined);
}

export function unset(n: number): string {
  return read(new Holder()) + String(n & 1);
}

export function set(n: number): string {
  const holder = new Holder();
  holder.__snapshot = n & 3;
  return read(holder);
}
