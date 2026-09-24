import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { onPick: (i: Item) => void; item: Item }) {
  const pick = useCallback((i: Item) => p.onPick(i), [p]);
  return <b onClick={() => pick(p.item)}>x</b>;
}
