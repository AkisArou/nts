import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { items: Item[] }) {
  const done = useMemo<Item[]>(() => p.items.filter((i) => i.done), [p.items]);
  return <b>{done.length}</b>;
}
