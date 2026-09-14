import type { Ptr, Struct, c_uint8, c_uint16, c_int32, c_double } from "c:types";
import { addrOf as address } from "c:memory";
type State = Struct<{ marker: c_uint8; total: c_double; count: c_uint16; tail: c_int32; data: Ptr<c_uint8> }, "NativeState">;
declare function stamp(p: Ptr<c_uint16>): void;
export function run(p: Ptr<State>): number {
    const alias = p;
    alias.total = 7.5;
    stamp(address(p, "count"));
    address(p, "data")[0] = address(p.data, 1);
    p.data[0] = 99;
    p[1].total = 3.25;
    return p.total + p.count + p.data[0];
}

type Keys = Struct<{ key: c_int32; count: c_int32 }, "KeyState">;
let keyCalls = 0;
function chooseKey(): "count" { keyCalls++; return "count"; }
export function computedKey(p: Ptr<Keys>): number {
  const key = "count";
  const before = p[chooseKey()];
  p[chooseKey()] += 2;
  address(p, chooseKey())[0] = 25;
  return before * 100 + p[key] + keyCalls;
}
