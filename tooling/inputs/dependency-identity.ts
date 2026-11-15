// The finite data contract shared by installation and its consumers.
export type Identity={version:2;key:string;pnpm:string;manager:string;node:string;platform:string;arch:string;inputs:{path:string;sha256:string}[];importers:string[]};
