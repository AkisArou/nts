import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { items: Item[] }) {
  const names: string[] = [];
  for (const it of p.items) names.push(it.name);
  return <b>{names.join()}</b>;
}
