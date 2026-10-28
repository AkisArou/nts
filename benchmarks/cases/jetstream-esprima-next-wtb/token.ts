// Esprima-next 6.0.3, BSD-2-Clause; original notice in esprima.ts and ../LICENSE-jetstream.
// Strict TypeScript transcription of the source embedded in the pinned JetStream bundle.
export const Token: {readonly BooleanLiteral: 1; readonly EOF: 2; readonly Identifier: 3; readonly Keyword: 4; readonly NullLiteral: 5; readonly NumericLiteral: 6; readonly Punctuator: 7; readonly StringLiteral: 8; readonly RegularExpression: 9; readonly Template: 10;} = {BooleanLiteral: 1, EOF: 2, Identifier: 3, Keyword: 4, NullLiteral: 5, NumericLiteral: 6, Punctuator: 7, StringLiteral: 8, RegularExpression: 9, Template: 10};
export type Token = typeof Token.BooleanLiteral | typeof Token.EOF | typeof Token.Identifier | typeof Token.Keyword | typeof Token.NullLiteral | typeof Token.NumericLiteral | typeof Token.Punctuator | typeof Token.StringLiteral | typeof Token.RegularExpression | typeof Token.Template;

export const TokenName: Record<number, string> = {};
TokenName[1] = 'Boolean';
TokenName[2] = '<end>';
TokenName[3] = 'Identifier';
TokenName[4] = 'Keyword';
TokenName[5] = 'Null';
TokenName[6] = 'Numeric';
TokenName[7] = 'Punctuator';
TokenName[8] = 'String';
TokenName[9] = 'RegularExpression';
TokenName[10] = 'Template';
