interface Entry { readonly name: string; }
interface Options { readonly entries: Entry[]; }

// Its same-named field widens the family's ABI; it never enters Options.
class Other { readonly entries: number[] = []; }
export function makeOther(): unknown { return new Other(); }

export function appendLocal(count: number): number {
  const options: Options = { entries: [] };
  const limit = count > 12 ? 12 : count;
  for (let i = 0; i < limit; i++) options.entries.push({ name: "entry" });
  return options.entries.length;
}
