import { pathToFileURL } from 'node:url';
const program = await import(pathToFileURL(process.argv[2]));
function report(value) {
  if (Number.isNaN(value)) console.log('nan');
  else { const bytes = Buffer.alloc(8); bytes.writeDoubleBE(value); console.log(bytes.toString('hex')); }
}
const indices = [NaN, -Infinity, -1.9, -0, 0, 0.9, 1, 2, 3, 4, 66, Infinity];
for (const n of [0, 1, 2, 17]) {
  report(program.unitsUnchecked(n));
  report(program.unitsDuringAppend(n));
  report(program.unitAfterAppend(n));
  for (const index of indices) report(program.unitsChecked(n, index));
}
