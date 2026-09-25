// A key after a spread cannot be separated from the props, so it falls back
// to createElement; before a spread, or after an inlined object literal, it
// is the call's third argument.
type Item = { id: string; label: string };

export function Keys({ items, extra }: { items: Item[]; extra: Record<string, unknown> }) {
  return (
    <ul>
      {items.map((item) => <li {...extra} key={item.id}>{item.label}</li>)}
      {items.map((item) => <li key={item.id} {...extra}>{item.label}</li>)}
      {items.map((item) => <li {...extra} key={item.id} />)}
      <li {...{ a: 1, b: "two" }} key="inline" />
      <li {...{ ...extra, c: 3 }} key="nested" />
      <li {...{ __proto__: null, d: 4 }} />
      <li key="first" key-ish="x" />
    </ul>
  );
}
