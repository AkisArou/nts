// Source control for builtin-study-web-structuredclone. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
function sourceClone(value: { a: number }): { a: number } { return { a: value.a }; }

export function webStructuredcloneControl(): number {
  const input = { a: 1 }; const output = sourceClone(input); input.a = 2; return output.a;
}
