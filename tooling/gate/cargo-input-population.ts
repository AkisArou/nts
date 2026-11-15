// Acquisition and both reusable-key validators use this same name population.
// Existing file keys validate bytes/modes; this also notices newly chosen files.
export function cargoInputNames(files:readonly {path:string}[]):string[]{
  return [...new Set(files.filter(row=>/(^|\/)Cargo.toml$/.test(row.path)||['Cargo.lock','rust-toolchain.toml'].includes(row.path)||row.path.startsWith('.cargo/')).map(row=>row.path))].sort();
}
export function changedCargoInputName(before:readonly string[],files:readonly {path:string}[]):string|undefined{
  const current=cargoInputNames(files),old=new Set(before),now=new Set(current);
  return [...new Set([...before,...current])].sort().find(path=>old.has(path)!==now.has(path));
}
