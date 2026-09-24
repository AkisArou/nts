import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function List<T extends { id: number }>(p: { items: T[]; render: (t: T) => string }) {
  const out = p.items.map((t) => <li key={t.id}>{p.render(t)}</li>);
  return <ul>{out}</ul>;
}
