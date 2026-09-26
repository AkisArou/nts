// node's half of a pinned-outcome run: print an uncaught exception the way a
// compiled nts program does, so the two runs compare as text.
//
//   nts:   nts: uncaught <Class>: <message>      exit 1
//   node:  nts: uncaught <Class>: <message>      exit 1   (this file)
//
// The class is the constructor's name, as nts reads it from the descriptor; a
// thrown non-object has none and prints as its String(), which nts cannot
// produce and which therefore shows up as a difference rather than hiding.
process.on("uncaughtException", (error) => {
  const name = error?.constructor?.name;
  const message = error?.message;
  process.stderr.write(
    name === undefined ? `nts: uncaught ${String(error)}\n` : `nts: uncaught ${name}: ${message ?? ""}\n`,
  );
  process.exit(1);
});
