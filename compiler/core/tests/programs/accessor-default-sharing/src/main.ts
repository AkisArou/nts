interface Labelled { readonly padding: number; readonly label?: string; readonly absent?: string; }
class Short { padding = 11; }
class Long { extra = 33; padding = 22; }
class Present {
  padding = 44;
  get label(): string { return "present"; }
}
function read(value: Labelled): string { return String(value.label) + "/" + String(value.absent); }
export function defaultLabel(n: number): string {
  const values: Labelled[] = [new Short(), new Long(), new Present()];
  return read(values[(n & 15) % 3]!);
}
