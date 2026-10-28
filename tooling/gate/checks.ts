/** A frozen check scope. Null means the whole step, never an empty subset. */
export type Checks = { steps: "all" | string[]; interop: string | null; doctests?: string | null };

export function unionChecks(a: Checks, b: Checks): Checks {
  const uses = (c: Checks, s: string) => c.steps === "all" || c.steps.includes(s);
  const scope = (s: string, x: string | null | undefined, y: string | null | undefined) => !uses(b, s) ? x : !uses(a, s) ? y
    : !x || !y ? null : [...new Set([...x.split(/\s+/), ...y.split(/\s+/)])].join(" ");
  return { steps: a.steps === "all" || b.steps === "all" ? "all" : [...new Set([...a.steps, ...b.steps])],
    interop: scope("interop", a.interop, b.interop) ?? null, doctests: scope("doctests", a.doctests, b.doctests) };
}
