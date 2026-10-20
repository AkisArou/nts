class C {
  valueOf() {
    return 33;
  }
}
export function run() {
  const rows = [["construct control", String(new C().valueOf())]];
  C = 44;
  rows.push(["reassigned", String(C === 44)]);
  return rows;
}
