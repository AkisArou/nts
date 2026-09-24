import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C({ n = 1, items = [] as Item[] }: { n?: number; items?: Item[] }) {
  const names = items.map((i) => i.name + n);
  return <b>{names.join()}</b>;
}
