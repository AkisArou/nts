// **Reads and writes the wrong field.** A value typed `Channel` can be any
// object with a `level`, and `Green` declares `extra` before it. A field access
// names one index, `Channel`'s -- 0 -- and on a `Green` index 0 is `extra`. The
// store lands in `extra`, the read answers `extra`, and nothing refuses.
//
// The class is lost where the two arms of the conditional join: the join is
// erased, and unerasing it to `Channel` assumes `Channel`'s layout. A typed
// parameter does not reach it -- a call that knows the class gets a copy of the
// callee for it -- so this is the shape that does.
//
// What fixes it is the field half of interfaces satisfied by shape: an access
// through a type its objects lay out in more than one order reads where the
// object's own class puts the field. Found on 2026-10-10 by the step 2f
// example, where a store through `Channel` agreed with node only because the
// read after it was forwarded from the store.
//
// `Red` is each case's control: it puts `level` first, where `Channel` does.
interface Channel {
  level: number;
}

class Red implements Channel {
  level: number = 0;
  tag: number = 1;
}

class Green implements Channel {
  extra: number = 2;
  level: number = 0;
}

function store(aRed: boolean): string {
  const red = new Red();
  const green = new Green();
  const c: Channel = aRed ? red : green;
  c.level = 200;
  return aRed ? `${red.level},${red.tag}` : `${green.extra},${green.level}`;
}

function read(aRed: boolean): string {
  const red = new Red();
  red.level = 7;
  const green = new Green();
  green.level = 7;
  const c: Channel = aRed ? red : green;
  // Compared, not printed: what it reads instead is a value of another
  // representation, whose bits change from run to run.
  return c.level === 7 ? "7" : "not 7";
}

observe("store, a Red", store(true));
observe("store, a Green", store(false));
observe("read, a Red", read(true));
observe("read, a Green", read(false));
done();
