import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { get?: <T>(k: string, d: T) => T }) {
  const v = p.get?.<number>("k", 1) ?? 0;
  return <b>{v}</b>;
}
