// expect: emit-c --napi -> calls new exports.Reading(1, 2).latitude === undefined
// control: typeof exports.Reading === "function" && new exports.Reading(1, 2).distance() === 3
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
// # It asks the addon rather than reading the text
//
// This was first filed as `lacks-addon "latitude"`, because reading emitted
// text is what `blockers-check.mjs` could do. That expectation is sound --
// `latitude` appears four times in `program.c` and zero times in `addon.c`,
// checked against three unrelated fixtures' addons as well -- but it has the
// weakness written into it: every absence form is classified as a guard, so it
// printed `guard ok` while the defect was present, green in a directory where
// green means fixed.
//
// The `calls` form runs the expression against a loaded addon, so this fixture
// now asserts the defect itself: **the field reads `undefined` on an instance
// whose method computed from it correctly.** It prints `reproduces`, and it
// stops the day the field crosses.
//
// The `control:` line is required by the form and is the whole reason it means
// anything. Every expression about a name that is not published is false, so
// without a control that must hold, "the field is undefined" would also be
// satisfied by a class that never compiled. `distance()` returning 3 says the
// constructor ran, the prototype is there, and the fields were populated.
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
// # And a prediction, labelled as one
//
// `process/src/main.ts:512` is `_fatalException = fatalException;` -- a **class
// field** on `class Process extends EventEmitter`, not a prototype method.
// `_fatalException` is the name in 73 of the 88 `process` files that pass
// interpreted and fail compiled, which is the largest single pile in that
// module.
//
// **Today those 73 fail for a different reason**: `process` publishes no
// instance at all, so the name is missing rather than fieldless. This gap is
// the wall *behind* that one, and it is written down as a prediction because
// the distinction is exactly the kind that turns into a wrong attribution --
// the fixture would otherwise read as claiming 73 files it does not currently
// block.
//
// When `Process` publishes, `_fatalException` crosses as a method or not at
// all. If it arrives on the prototype instead, this prediction was wrong and
// the reason is worth knowing.
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
