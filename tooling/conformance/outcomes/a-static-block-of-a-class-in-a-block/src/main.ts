// A class declared inside a block never runs its static elements: its static
// block does not run, so a `throw` in it is not caught and a push in it never
// happens. Found by test262's statements/class/static-init-abrupt.js, whose
// class sits in a `try` block, and it is not the `try`: a bare block does
// the same. The control declares the class at module scope and differs in
// the enclosing block only.
const order: string[] = [];
{
  class InBlock {
    static {
      order.push("in a block");
    }
  }
}
class AtModuleScope {
  static {
    order.push("at module scope");
  }
}
observe("order", order.join(","));
done();
