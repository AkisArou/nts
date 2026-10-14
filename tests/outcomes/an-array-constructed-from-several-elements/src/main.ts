// `new Array(0, 1, 2, 3)` with more than one argument makes an array of those
// elements. nts makes an *empty* one -- length 0, `join()` "", `pop()` and
// `shift()` undefined -- dropping every element. No diagnostic. Found by the
// first test/built-ins census: Array/prototype/{join,pop,shift}/S15.4.4.*_A1.2_*.
const x = new Array(0, 1, 2, 3);
observe("length", String(x.length));
observe("join", x.join());
const y = new Array(0, 1, 2, 3);
observe("pop", String(y.pop()));
const z = new Array(0, 1, 2, 3);
observe("shift", String(z.shift()));
done();
