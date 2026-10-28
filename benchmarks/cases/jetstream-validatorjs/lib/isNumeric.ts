/*
Copyright (c) 2018 Chris O'Hara <cohara87@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// JetStream source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/validatorjs/dist/bundle.es6.js.map
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isNumeric.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import assertString from './util/assertString.ts';
import { decimal } from './alpha.ts';

const numericNoSymbols = /^[0-9]+$/;

export default function isNumeric(str: string, options?: { no_symbols?: boolean; locale?: string }) {
  assertString(str);
  if (options && options.no_symbols) {
    return numericNoSymbols.test(str);
  }
  return (new RegExp(`^[+-]?([0-9]*[${(options || {}).locale ? decimal[String(options?.locale)] : '.'}])?[0-9]+$`)).test(str);
}
