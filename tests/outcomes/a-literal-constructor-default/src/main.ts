// The control for blockers/a-private-field-read-by-a-constructor-default
// (an outcomes record until 702ab2982, when its SIGSEGV became a refusal): the same
// class, whose default is the literal the field holds instead of a read.
class A {
  #x = "hello";
  value: string;
  constructor(o = "hello") {
    this.value = o;
  }
}
observe("value", new A().value);
done();
