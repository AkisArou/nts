// The control for a-private-field-read-by-a-constructor-default: the same
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
