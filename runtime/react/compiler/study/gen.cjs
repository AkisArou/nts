// One component or hook per TypeScript-only construct. Each must typecheck
// cleanly as written and must be compiled by React Compiler.
const fs = require("fs");
const H = `import { useState, useRef, useReducer, useMemo, useCallback } from "react";\n`;
const T = `type Item = { id: number; name: string; done?: boolean };\ntype Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };\n`;
const cases = {
  "nonnull-member": `export function C(p: { name?: string }) {\n  const n = p.name!.toUpperCase();\n  return <b>{n}</b>;\n}`,
  "nonnull-arg": `function len(s: string): number { return s.length; }\nexport function C(p: { name?: string }) {\n  const n = len(p.name!);\n  return <b>{n}</b>;\n}`,
  "nonnull-after-optional": `export function C(p: { a?: { b?: string } }) {\n  const s = p.a?.b!.length;\n  return <b>{s}</b>;\n}`,
  "as-const": `export function C(p: { n: number }) {\n  const pair = [p.n, "x"] as const;\n  const first: number = pair[0];\n  return <b>{first}{pair[1]}</b>;\n}`,
  "satisfies": `type Rec = Record<string, number>;\nexport function C(p: { n: number }) {\n  const o = { a: p.n } satisfies Rec;\n  return <b>{o.a}</b>;\n}`,
  "as-cast": `export function C(p: { v: unknown }) {\n  const s = (p.v as string).length;\n  return <b>{s}</b>;\n}`,
  "generic-component": `export function List<T extends { id: number }>(p: { items: T[]; render: (t: T) => string }) {\n  const out = p.items.map((t) => <li key={t.id}>{p.render(t)}</li>);\n  return <ul>{out}</ul>;\n}`,
  "generic-hook": `export function useLatest<T>(value: T): { current: T } {\n  const ref = useRef<T>(value);\n  ref.current = value;\n  return ref;\n}`,
  "instantiation-expr": `function id<T>(x: T): T { return x; }\nexport function C(p: { s: string }) {\n  const f = id<string>;\n  const v = f(p.s);\n  return <b>{v}</b>;\n}`,
  "call-type-args": `export function C(p: { first: Item }) {\n  const [sel, setSel] = useState<Item | null>(null);\n  const pick = () => setSel(p.first);\n  return <b onClick={pick}>{sel?.name}</b>;\n}`,
  "generic-jsx-element": `function Row<T>(p: { value: T; show: (v: T) => string }) { return <i>{p.show(p.value)}</i>; }\nexport function C(p: { n: number }) {\n  return <Row<number> value={p.n} show={(v) => v.toFixed(1)} />;\n}`,
  "local-type-alias": `export function C(p: { n: number }) {\n  type Pair = [number, number];\n  const pair: Pair = [p.n, p.n + 1];\n  return <b>{pair[0]}</b>;\n}`,
  "local-interface": `export function C(p: { n: number }) {\n  interface Box { v: number }\n  const box: Box = { v: p.n };\n  const f = (b: Box) => b.v * 2;\n  return <b>{f(box)}</b>;\n}`,
  "local-type-in-callback": `export function C(p: { xs: number[] }) {\n  type N = number;\n  const doubled = p.xs.map((x: N) => x * 2);\n  return <b>{doubled.join()}</b>;\n}`,
  "optional-param": `export function C(p: { n: number }) {\n  const f = (a?: number) => (a ?? 0) + p.n;\n  return <b>{f()}</b>;\n}`,
  "default-param": `export function C(p: { n: number }) {\n  const f = (a: number = 1) => a + p.n;\n  return <b>{f()}</b>;\n}`,
  "rest-param": `export function C(p: { n: number }) {\n  const sum = (...xs: number[]) => xs.reduce((a, b) => a + b, p.n);\n  return <b>{sum(1, 2)}</b>;\n}`,
  "definite-assignment": `export function C(p: { n: number }) {\n  let x!: number;\n  const init = () => { x = p.n; };\n  init();\n  return <b>{x}</b>;\n}`,
  "typed-let-branches": `export function C(p: { n: number }) {\n  let label: string | null;\n  if (p.n > 0) { label = "pos"; } else { label = null; }\n  return <b>{label}</b>;\n}`,
  "typed-empty-array": `export function C(p: { items: Item[] }) {\n  const names: string[] = [];\n  for (const it of p.items) names.push(it.name);\n  return <b>{names.join()}</b>;\n}`,
  "typed-empty-record": `export function C(p: { items: Item[] }) {\n  const byId: Record<number, Item> = {};\n  for (const it of p.items) byId[it.id] = it;\n  return <b>{Object.keys(byId).length}</b>;\n}`,
  "typed-map-callback": `export function C(p: { items: Item[] }) {\n  const names = p.items.map((it: Item) => it.name);\n  return <b>{names.join()}</b>;\n}`,
  "event-handler": `export function C(p: { onPick: (x: number) => void }) {\n  const click = (e: React.MouseEvent<HTMLButtonElement>) => p.onPick(e.clientX);\n  return <button onClick={click}>go</button>;\n}`,
  "use-ref-dom": `export function C(p: { n: number }) {\n  const ref = useRef<HTMLDivElement>(null);\n  const focus = () => ref.current?.focus();\n  return <div ref={ref} onClick={focus}>{p.n}</div>;\n}`,
  "use-reducer": `type Act = { type: "inc" } | { type: "add"; by: number };\nfunction reduce(s: number, a: Act): number { return a.type === "inc" ? s + 1 : s + a.by; }\nexport function C(p: { by: number }) {\n  const [n, dispatch] = useReducer(reduce, 0);\n  const add = () => dispatch({ type: "add", by: p.by });\n  return <b onClick={add}>{n}</b>;\n}`,
  "discriminated-union": `export function C(p: { s: Shape }) {\n  let area: number;\n  if (p.s.kind === "circle") { area = p.s.r * p.s.r * 3; } else { area = p.s.side * p.s.side; }\n  return <b>{area}</b>;\n}`,
  "typeof-narrowing": `export function C(p: { v: string | number }) {\n  const s = typeof p.v === "string" ? p.v.toUpperCase() : p.v.toFixed(2);\n  return <b>{s}</b>;\n}`,
  "return-type-arrow": `export function C(p: { n: number }) {\n  const make = (): Item => ({ id: p.n, name: "x" });\n  const it = make();\n  return <b>{it.name}</b>;\n}`,
  "nested-function-return-type": `export function C(p: { n: number }) {\n  function helper(): number { return p.n * 2; }\n  return <b>{helper()}</b>;\n}`,
  "generic-nested-arrow": `export function C(p: { a: number; b: string }) {\n  const pick = <K extends keyof typeof p>(k: K): (typeof p)[K] => p[k];\n  return <b>{pick("b")}</b>;\n}`,
  "type-predicate-filter": `export function C(p: { items: (Item | null)[] }) {\n  const real = p.items.filter((x): x is Item => x !== null);\n  return <b>{real.map((x) => x.name).join()}</b>;\n}`,
  "hook-tuple-return": `export function useToggle(init: boolean): [boolean, () => void] {\n  const [on, setOn] = useState(init);\n  const flip = () => setOn((v) => !v);\n  return [on, flip];\n}`,
  "hook-as-const-return": `export function useToggle(init: boolean) {\n  const [on, setOn] = useState(init);\n  const flip = () => setOn((v) => !v);\n  return [on, flip] as const;\n}`,
  "readonly-param": `export function C(p: { xs: readonly number[] }) {\n  const total = p.xs.reduce((a, b) => a + b, 0);\n  return <b>{total}</b>;\n}`,
  "use-memo-typed": `export function C(p: { items: Item[] }) {\n  const done = useMemo<Item[]>(() => p.items.filter((i) => i.done), [p.items]);\n  return <b>{done.length}</b>;\n}`,
  "use-callback-typed": `export function C(p: { onPick: (i: Item) => void; item: Item }) {\n  const pick = useCallback((i: Item) => p.onPick(i), [p]);\n  return <b onClick={() => pick(p.item)}>x</b>;\n}`,
  "local-enum": `export function C(p: { n: number }) {\n  enum Dir { Up, Down }\n  const d = p.n > 0 ? Dir.Up : Dir.Down;\n  return <b>{d}</b>;\n}`,
  "assertion-function": `function assertStr(v: unknown): asserts v is string { if (typeof v !== "string") throw new Error(); }\nexport function C(p: { v: unknown }) {\n  assertStr(p.v);\n  const n = p.v.length;\n  return <b>{n}</b>;\n}`,
  "optional-call-generic": `export function C(p: { get?: <T>(k: string, d: T) => T }) {\n  const v = p.get?.<number>("k", 1) ?? 0;\n  return <b>{v}</b>;\n}`,
  "object-destructure-defaults": `export function C({ n = 1, items = [] as Item[] }: { n?: number; items?: Item[] }) {\n  const names = items.map((i) => i.name + n);\n  return <b>{names.join()}</b>;\n}`,
};
for (const [name, body] of Object.entries(cases)) fs.writeFileSync(`orig/${name}.tsx`, H + T + body + "\n");
console.log(Object.keys(cases).length, "fixtures");
