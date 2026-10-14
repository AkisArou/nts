// Hand-written, because this case passes an array.
//
// `workload` synthesises a driver from `export const seed`, which every other
// case has and this one cannot: the buffer is filled before each call and the
// contents compound if it is not, so there is state to reset rather than an
// expression to write down. `driver.cpp` and `driver.java` are the same escape
// hatch on the other two lanes.
import { measure } from "../../common/bench.mjs";
import { scale } from "./case.ts";

const xs = new Array(4096).fill(1);
measure(() => scale(xs, 1.0000001));
