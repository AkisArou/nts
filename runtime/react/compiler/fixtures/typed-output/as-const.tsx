import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { n: number }) {
  const pair = [p.n, "x"] as const;
  const first: number = pair[0];
  return <b>{first}{pair[1]}</b>;
}
