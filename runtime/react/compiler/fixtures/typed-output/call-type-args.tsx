import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { first: Item }) {
  const [sel, setSel] = useState<Item | null>(null);
  const pick = () => setSel(p.first);
  return <b onClick={pick}>{sel?.name}</b>;
}
