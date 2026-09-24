import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { name?: string }) {
  const n = p.name!.toUpperCase();
  return <b>{n}</b>;
}
