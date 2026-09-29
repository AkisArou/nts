// A class whose static field is declared twice runs its static elements in
// declaration order: field, block, field, block. nts runs the second
// field's initializer in the first one's place, then again in its own
// (second field, first block, second field, ...). Found by test262's
// statements/class/static-init-sequence.js. The control names the second
// field differently and differs in that name only.
var sequence: string[] = [];
class Twice {
  // @ts-expect-error -- JavaScript: a class may declare a field twice
  static x = sequence.push("first field");
  static {
    sequence.push("first block");
  }
  // @ts-expect-error -- as above
  static x = sequence.push("second field");
  static {
    sequence.push("second block");
  }
}
var control: string[] = [];
class Distinct {
  static x = control.push("first field");
  static {
    control.push("first block");
  }
  static y = control.push("second field");
  static {
    control.push("second block");
  }
}
observe("twice", sequence.join(","));
observe("distinct", control.join(","));
done();
