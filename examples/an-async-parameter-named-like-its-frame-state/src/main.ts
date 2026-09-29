// An async function whose parameters are named `state`, `result` and `awaited`.
//
// A suspended function's frame keeps its resumption point in `state`, its
// promise in `result` and the last awaited promise in `awaited` -- and each
// parameter under the parameter's own name. So a parameter spelled like one of
// those is a second field of that name in one class. C spells the later one
// `state_7` (`c_member_at`); the JVM names fields too, and declined the frame
// under NTS4013, "declares both `state` and `state`". Reduced from
// web-platform's `HttpCache#serve(entry, method, age, state)`, whose frame was
// then never written and five runtime modules could not load (jvm-verifies
// cause G).

async function settle(n: number): Promise<number> {
  return n * 2;
}

export async function resumed(state: number, result: number, awaited: number): Promise<number> {
  const first = await settle(state);
  const second = await settle(result);
  return first + second + awaited;
}

// The control: the same body, parameters named nothing the frame uses.
export async function control(a: number, b: number, c: number): Promise<number> {
  const first = await settle(a);
  const second = await settle(b);
  return first + second + c;
}
