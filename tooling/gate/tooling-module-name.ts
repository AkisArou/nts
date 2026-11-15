// The strict tooling project owns these executable source modules. Bootstrap
// readers share this parser-free inventory; widening it belongs here.
export const toolingModuleName=(name:string)=>name.startsWith('tooling/')&&/\.(?:ts|mjs)$/.test(name)&&!name.split('/').includes('node_modules');
