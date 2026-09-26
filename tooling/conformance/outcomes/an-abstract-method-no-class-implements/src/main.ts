// **A call to an abstract method no class implements is declined by the C
// backend, and no line names the method.** Every dependent says it was
// "refused above", about a refusal that was never printed. The call can never
// run (the array is always empty), and node answers 0.
//
// Found by the React lane (2026-09-27, `~/.cache/nts-react/probes/abstract-no-override`).
// The control, measured on 81ca51a21 with this record, differs in one thing: a class
// `Two extends Maker` implements `make`. That program compiles and agrees (0).
//
// The missing root line is the same family as 1962b826c's leaf naming: a
// cascade whose head is not reported. What should change is the diagnostic
// (a root naming `Maker#make`). Whether the call should compile at all is a
// separate question, since no receiver can exist. Either change moves this
// record, and a person decides which it was.
abstract class Maker {
  abstract make(n: number): number;
}

class Holder {
  readonly makers: Maker[] = [];

  total(): number {
    let sum = 0;
    for (let i = 0; i < this.makers.length; i++) {
      sum += this.makers[i]!.make(1);
    }
    return sum;
  }
}

observe("a call no receiver can reach", String(new Holder().total()));
done();
