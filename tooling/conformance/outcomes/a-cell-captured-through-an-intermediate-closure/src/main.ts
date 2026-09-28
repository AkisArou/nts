// **Now a guard.** `c939f222e` fixed it, and this record was taken from a clean
// build of that commit, where it agrees with node. The cause: `escape.rs`'s
// `FieldSet` rule is "what goes in is reachable from wherever the container is,
// **and no further**", so a container the function allocated and confines keeps
// its contents in the frame. That is false for a container passed to a function
// that copies its fields out, and nothing published the obligation --
// `stores_into` and `returned_params` both match a bare parameter, and here the
// escaping value is a *field read*. `leaks_its_fields` is the third obligation.
// The history is kept beneath.
//
// **A `let` captured by an arrow created inside another arrow over the same
// `let` put the cell on the stack, and the handlers carried its address out of
// the frame.** `make`'s closure is an allocation `build` can confine, so the
// cell went with it -- `NtsObj_Cell0 v5_frame`, `NTS_IMMORTAL` -- while the
// arrows `make` returns are pushed into a module-level array and outlive the
// block. Reading `total` through them then reads a dead frame: **exit 139**,
// where node answers `36 60 120`.
//
// The React lane found it in react-gtk's adw driver, as a dangling reference the
// cycle collector tripped over at exit, and it took two refuted suspects to get
// here -- the collector freeing a buffered candidate, and an over-release of the
// cell. Neither: the cell was never on the heap.
//
// **Why this is an outcome and not an example.** A program with the bug *agrees
// with node* whenever the dead frame still happens to hold the right bytes, and
// `nts check` drives exported functions directly, so the build-churn-call
// sequence that exposes it never happens: both arms agreed on 58 cases. Only run
// as a program does the control exit 139. That is also why one extra line
// anywhere in the driver decided whether the React lane saw it.
//
// **Expected, confirmed under node:**
//
//     accumulated                  36
//     twice                        60
//     directly (control)          120
const handlers: ((n: number) => number)[] = [];

function build(): void {
  let total = 0;
  const make = (weight: number): ((n: number) => number) => (n: number) => {
    total = total + n * weight;
    return total;
  };
  handlers.push(make(2));
  handlers.push(make(10));
}

// CONTROL: the same handlers built in the block with no intermediate arrow, so
// the store's container is the escaping closure itself and the cell was always
// heap-allocated. It must keep agreeing.
function buildDirectly(): void {
  let total = 0;
  const light = 2;
  const heavy = 10;
  handlers.push((n: number) => {
    total = total + n * light;
    return total;
  });
  handlers.push((n: number) => {
    total = total + n * heavy;
    return total;
  });
}

// Between building and calling, so a frame slot the cell used is written over.
function churn(depth: number): number {
  const scratch: number[] = [depth, depth + 1, depth + 2, depth + 3, depth + 4];
  let sum = 0;
  for (let i = 0; i < scratch.length; i++) {
    sum = sum + scratch[i]!;
  }
  return depth > 0 ? sum + churn(depth - 1) : sum;
}

function drive(make: () => void, n: number): number {
  handlers.length = 0;
  make();
  churn(6);
  let last = 0;
  for (let i = 0; i < handlers.length; i++) {
    last = handlers[i]!(n);
  }
  return last;
}

observe("accumulated", String(drive(build, 3)));
observe("twice", String(drive(build, 5)));
observe("directly (control)", String(drive(buildDirectly, 10)));
done();
