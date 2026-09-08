// expect: emit-c --napi -> emits-c NtsString * header;
//
// A property called `header` collides with the object header every managed
// struct carries, and the C compiler rejects the result:
//
//     struct NtsObj_Type7036 {
//         NtsHeader header;        <- the runtime's
//         NtsString * message;
//         NtsString * header;      <- the program's
//         bool skipped;
//     };
//     error: duplicate member 'header'
//     error: static assertion failed ... is not the size nts computed
//
// The second error is the more interesting one: the layout the compiler computed
// and the layout C produced disagree, so even a C compiler that tolerated the
// duplicate would lay the object out differently than the program expects.
//
// `assert` is the module this came from and it is not exotic — a record with a
// `header` field is ordinary in any code that formats output. The name is not
// reserved anywhere a reader could see; it becomes reserved only once the struct
// is emitted.
//
// **Found only after the void-field fix landed.** Every one of these modules was
// failing on `field has incomplete type 'void'` first, so this was masked behind
// a louder error in the same file. Fixing one class of emitter defect revealed
// the next, which is the ordinary shape of this work and worth saying because
// the fifteen-modules-do-not-compile number will not fall by fifteen.
interface Row {
  message: string;
  header: string;
  skipped: boolean;
}

export function describe(row: Row): string {
  return row.header + row.message;
}

export function run(): string {
  return describe({ message: "m", header: "h", skipped: false });
}
