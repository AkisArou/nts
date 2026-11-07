// Original TypeScript/src/gen/immer-tiny/tsconfig.json, unchanged as a value.
// WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b
export interface TypeScriptConfiguration {
    compilerOptions: { [option: string]: string | boolean };
    files: string[];
}
export const configuration: TypeScriptConfiguration = {
  "compilerOptions": {
    "target": "ES2020",
    "strict": true,
    "declaration": true,
    "importHelpers": false,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "noUnusedLocals": false,
    "sourceMap": true,
    "declarationMap": true,
    "noEmit": true,
    "module": "ES6",
    "allowJs": true
  },
  "files": [
    "./src/immer.ts",
    "./src/plugins/mapset.ts",
    "./src/plugins/patches.ts",
    "src/types/globals.d.ts"
  ]
};
