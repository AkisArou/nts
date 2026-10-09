// A closure reads an array element with a non-null assertion and is called
// through a function value inside a `try`, so it has a raising copy -- as the
// React lane's gtk driver's `unbind` handler reads `rowNodes[at]!`.
//
// In the raising copy the assertion throws a `TypeError` where the ordinary
// body calls `nts_assertion_failed`, so only that copy's builder made the
// error's layout, and it was dropped with the builder: the copy allocated a
// type with no layout, and the LLVM backend declined it (NTS3001). Bisected by
// the React lane to e120751f6, which made the assertion throw in a raising body.

class Row {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}

function run(handler: (at: number) => void, at: number): number {
  try {
    handler(at);
    return 1;
  } catch (error) {
    return -1;
  }
}

export function unbound(n: number): number {
  const rows: (Row | null)[] = [new Row("a"), null];
  let log = "";
  const unbind = (at: number): void => {
    const row = at < 0 ? null : rows[at]!;
    if (row !== null) {
      log += row.name + ";";
    }
  };
  return run(unbind, n < 0 ? -1 : 0) * 10 + log.length;
}
