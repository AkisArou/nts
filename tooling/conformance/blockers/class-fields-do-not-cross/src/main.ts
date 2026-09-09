// expect: emit-c --napi -> lacks-addon "latitude"
//
// A class crosses to the host with its methods and without its fields.
//
// `napi_define_class` is emitted, the constructor allocates, the prototype
// carries the methods, and they all work. The property descriptor list holds
// only the methods:
//
//     napi_property_descriptor members[] = {
//         { "distance", NULL, nts_napi_Reading__distance, … },
//         { "describe", NULL, nts_napi_Reading__describe, … }
//     };
//
// There is no entry for `latitude`, `longitude` or `station`, so on the host:
//
//     Object.keys(reading)   []
//     reading.latitude       undefined
//     reading.distance()     works, and reads `this.latitude`
//
// **The methods reading the fields are the control.** `distance()` answers from
// `latitude` and `longitude`, and `describe()` answers from `station`, so the
// fields are populated -- they are unreachable from the host, not unset. If
// those two ever stop working, this fixture is about something else and the
// expectation below stops meaning what it says.
//
// # Why `lacks-addon "latitude"` and not the descriptor spelling
//
// The absence assertion this wants is "the wrapper does not name the field".
// Naming the C spelling -- `{ "latitude", NULL,` -- would keep holding after a
// fix that exposed the field a different way, and an absence assertion that
// survives its own fix is silent forever.
//
// `"latitude"` is chosen to be long enough that it cannot appear incidentally.
// A field called `x` would make this expectation hold or fail on unrelated
// emitted text.
//
// # It reads `guard ok` while the defect is present, and that is a weakness
//
// `blockers-check.mjs` classifies every absence form as a guard, so this file
// prints `guard ok` today -- green, in a directory where green usually means
// fixed. It is not fixed; the text it names is absent because the wrapper does
// not do the thing yet.
//
// Written down rather than worked around because the alternative is worse. The
// forms that print `reproduces` all name a diagnostic, and there is no
// diagnostic here: the class lowers, publishes and runs. The only static
// signal available is what the wrapper did not write.
//
// **What to watch is the transition.** The moment the wrapper names `latitude`
// this stops holding and prints a line asking for a person, which is when the
// fixture has something to say. Until then it is a tripwire, not a report, and
// the report is the ledger section it points at.
//
// # What it is not
//
// `export-class` is fixed and is the other half: "a Node-API class needs a
// constructor that allocates the instance, a prototype carrying the methods,
// and a finalizer". All three work here. Nothing in that fixture, or anywhere
// in this directory, is about the fields.
//
// # What it costs
//
// `fs.Stats` is the only class instance a compiled module hands back today, and
// all ten of its declared fields read `undefined` while all eight of its
// predicates answer correctly. **24 of node's `test-fs-*.js` read a `.size`,
// `.mode`, `.mtimeMs`, `.nlink` or `.ino` off a stat.** `stats.size` is the
// point of the object; `isFile()` is the convenience.
//
// Measured on `Stats` and on this reduction, which is two cases and not one --
// `Stats` could have been peculiar, and it is not.

export class Reading {
  latitude: number;
  longitude: number;
  readonly station: string;

  constructor(latitude: number, longitude: number) {
    this.latitude = latitude;
    this.longitude = longitude;
    this.station = "north";
  }

  /** Control: reads two fields, so their absence on the host is not absence. */
  distance(): number {
    return this.latitude + this.longitude;
  }

  /** Control: reads the readonly field. */
  describe(): string {
    return this.station;
  }
}
