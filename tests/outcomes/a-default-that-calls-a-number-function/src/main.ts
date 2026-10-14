// The control for a-default-that-calls-a-void-function: the default's call
// returns a number, and differs in that only.
let initCount = 0;
function counter(): number { initCount += 1; return 1; }
let seen = "none";
function h({ w = counter() }: { w?: unknown }) {
  seen = String(w === null) + "," + String(initCount);
}
h({ w: null });
observe("seen", seen);
done();
