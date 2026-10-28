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
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isISO6346.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import assertString from './util/assertString.ts';

// https://en.wikipedia.org/wiki/ISO_6346
// according to ISO6346 standard, checksum digit is mandatory for freight container but recommended
// for other container types (J and Z)
const isISO6346Str = /^[A-Z]{3}(U[0-9]{7})|([J,Z][0-9]{6,7})$/;
const isDigit = /^[0-9]$/;

export function isISO6346(str: string) {
  assertString(str);

  str = str.toUpperCase();

  if (!isISO6346Str.test(str)) return false;

  if (str.length === 11) {
    let sum = 0;
    for (let i = 0; i < str.length - 1; i++) {
      if (!isDigit.test(str[i])) {
        let convertedCode;
        const letterCode = str.charCodeAt(i) - 55;
        if (letterCode < 11) convertedCode = letterCode;
        else if (letterCode >= 11 && letterCode <= 20) convertedCode = 12 + (letterCode % 11);
        else if (letterCode >= 21 && letterCode <= 30) convertedCode = 23 + (letterCode % 21);
        else convertedCode = 34 + (letterCode % 31);
        sum += convertedCode * (2 ** i);
      } else sum += Number(str[i]) * (2 ** i);
    }

    let checkSumDigit = sum % 11;
    if (checkSumDigit === 10) checkSumDigit = 0;
    return Number(str[str.length - 1]) === checkSumDigit;
  }

  return true;
}

export const isFreightContainerID = isISO6346;
