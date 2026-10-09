import type { Ptr, Struct } from "c:types";
import type { Uint8, Uint16, Int32, Float64 } from "@nts/scalars";
import { addrOf as address } from "c:memory";
type State = Struct<{ marker: Uint8; total: Float64; count: Uint16; tail: Int32; data: Ptr<Uint8> }, "NativeState">;
declare function stamp(p: Ptr<Uint16>): void;
export function run(p: Ptr<State>): number {
    const alias = p;
    alias.total = 7.5;
    stamp(address(p.count));
    address(p.data)[0] = address(p.data[1]);
    p.data[0] = 99;
    p[1].total = 3.25;
    return p.total + p.count + p.data[0];
}

type Keys = Struct<{ key: Int32; count: Int32 }, "KeyState">;
let keyCalls = 0;
function chooseKey(): "count" { keyCalls++; return "count"; }
export function computedKey(p: Ptr<Keys>): number {
  const key = "count";
  const before = p[chooseKey()];
  // A compound assignment through a computed key: `|`, whose result stays an
  // `int32_t` (17 | 2 is the 19 that `+= 2` gave), where `+ 2` could not be
  // proven to.
  p[chooseKey()] |= 2;
  address(p[chooseKey()])[0] = 25;
  return before * 100 + p[key] + keyCalls;
}
