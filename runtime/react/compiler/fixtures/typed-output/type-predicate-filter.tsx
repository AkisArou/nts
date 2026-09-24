import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { items: (Item | null)[] }) {
  const real = p.items.filter((x): x is Item => x !== null);
  return <b>{real.map((x) => x.name).join()}</b>;
}
