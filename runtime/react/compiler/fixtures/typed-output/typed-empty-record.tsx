import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { items: Item[] }) {
  const byId: Record<number, Item> = {};
  for (const it of p.items) byId[it.id] = it;
  return <b>{Object.keys(byId).length}</b>;
}
