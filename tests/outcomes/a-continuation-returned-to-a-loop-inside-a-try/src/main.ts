// **Ours, not upstream's: React's scheduler loop in miniature.** A task's
// callback may return its continuation, a function of its own type
// (`type Callback = (didTimeout: boolean) => Callback | null | undefined`),
// and the loop keeps the task while `typeof continuation === "function"`. The
// loop runs inside a `try`. Compiled, the continuation is never seen as a
// function: the task stops after its first slice and the work it yielded is
// dropped -- no refusal, no crash. React's scheduler yields this way
// (`performWorkOnRootViaSchedulerTask` returns itself), so a yielded render
// would silently never resume.
//
// Each control differs in one thing and agrees today:
//   - `Callback | null`, without `undefined`, in the callback's return type;
//   - testing `continuation !== null && continuation !== undefined` instead
//     of `typeof continuation === "function"`.
//
// **Expected, confirmed under node:**
//
//     typeof, F | null | undefined         +
//     null check, F | null | undefined (control)   +
//     typeof, F | null (control)           +
//     a throwing task                      caught task
type Callback = (didTimeout: boolean) => Callback | null | undefined;
type TwoWay = (didTimeout: boolean) => TwoWay | null;

class Task {
  callback: Callback | null;
  constructor(callback: Callback) {
    this.callback = callback;
  }
}

class TwoWayTask {
  callback: TwoWay | null;
  constructor(callback: TwoWay) {
    this.callback = callback;
  }
}

let left = 0;
function step(_didTimeout: boolean): Callback | null | undefined {
  left--;
  return left > 0 ? step : null;
}
function twoWayStep(_didTimeout: boolean): TwoWay | null {
  left--;
  return left > 0 ? twoWayStep : null;
}

function byTypeof(task: Task): boolean {
  const callback = task.callback;
  if (typeof callback === "function") {
    task.callback = null;
    const continuation = callback(false);
    if (typeof continuation === "function") {
      task.callback = continuation;
      return true;
    }
  }
  return false;
}

function byNullCheck(task: Task): boolean {
  const callback = task.callback;
  if (typeof callback === "function") {
    task.callback = null;
    const continuation = callback(false);
    if (continuation !== null && continuation !== undefined) {
      task.callback = continuation;
      return true;
    }
  }
  return false;
}

function twoWayByTypeof(task: TwoWayTask): boolean {
  const callback = task.callback;
  if (typeof callback === "function") {
    task.callback = null;
    const continuation = callback(false);
    if (typeof continuation === "function") {
      task.callback = continuation;
      return true;
    }
  }
  return false;
}

// The work loop, inside a `try` as the scheduler's `flushWork` is: the marks
// are the slices after the first.
function flush(loop: () => boolean): string {
  let slices = "";
  try {
    while (loop()) {
      slices += "+";
    }
    return slices;
  } catch (error) {
    return "caught " + (error instanceof Error ? error.message : "a non-error");
  }
}

left = 2;
const viaTypeof = new Task(step);
observe("typeof, F | null | undefined", flush(() => byTypeof(viaTypeof)));
left = 2;
const viaNullCheck = new Task(step);
observe("null check, F | null | undefined (control)", flush(() => byNullCheck(viaNullCheck)));
left = 2;
const twoWay = new TwoWayTask(twoWayStep);
observe("typeof, F | null (control)", flush(() => twoWayByTypeof(twoWay)));
const throwing = new Task(() => {
  throw new Error("task");
});
observe("a throwing task", flush(() => byTypeof(throwing)));
done();
