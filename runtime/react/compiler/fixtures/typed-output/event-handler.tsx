import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { onPick: (x: number) => void }) {
  const click = (e: React.MouseEvent<HTMLButtonElement>) => p.onPick(e.clientX);
  return <button onClick={click}>go</button>;
}
