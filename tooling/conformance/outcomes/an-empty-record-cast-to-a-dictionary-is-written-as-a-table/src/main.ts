// run: check
// backend: jvm
// A record cannot become dictionary storage through a TypeScript assertion.
// The JVM catches the table reinterpretation; native RC also aborts when a
// table store writes past the empty record. Queue with record dictionary views.
export function result(n: number): number {
  const fresh = {};
  (fresh as Record<string, unknown>)["read"] = n + 3;
  return n;
}
