// Generated module names are capability keys, never arbitrary filesystem paths.
export function runtimeModuleName(name:unknown):name is string{
  return typeof name==='string'&&name.endsWith('.mjs')&&name.split('/').every(part=>
    part!==''&&part!=='.'&&part!=='..'&&/^[A-Za-z0-9_.-]+$/.test(part));
}
export function runtimeAssets(assets:unknown,required:readonly string[]):assets is Record<string,string>{
  if(!assets||typeof assets!=='object'||Array.isArray(assets))return false;
  const rows=Object.entries(assets);
  return rows.length>0&&rows.length<=128&&required.every(name=>Object.hasOwn(assets,name))&&
    rows.every(([name,hash])=>runtimeModuleName(name)&&typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash));
}
