// run: check
//
// The `async function*` twin of
// tests/outcomes/a-generator-declaration-stored-as-a-signature-with-other-generator-arguments:
// a declaration stored in a `Make[]` whose `AsyncGenerator<…>` is not its own.
// `Make` writes `AsyncGenerator<number>`, which is
// `AsyncGenerator<number, any, any>`; the checker types `counted` from its body
// as `AsyncGenerator<number, void, any>`. Its frame extends its own generator,
// and a value returned through `Make` is typed as the other, which no frame
// extends. Lowering refuses `total` by name (`suspend::refuse_uninhabited`),
// and the sentence names the protocol the abstract generator speaks:
// `AsyncGenerator<…>` here, `Generator<…>` in the twin.
type Make = () => AsyncGenerator<number>;

let first = 1;

async function* counted() {
  yield first + 1;
  yield first + 2;
}

const makers: Make[] = [counted];

export async function total(seed: number): Promise<number> {
  let sum = 0;
  for await (const value of makers[seed & 0]()) {
    sum = sum + value;
  }
  return sum;
}
