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
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isISBN.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import assertString from './util/assertString.ts';

const possibleIsbn10 = /^(?:[0-9]{9}X|[0-9]{10})$/;
const possibleIsbn13 = /^(?:[0-9]{13})$/;
const factor = [1, 3];

export default function isISBN(isbn: string, options?: { version?: string | number } | string | number | null): boolean {
  assertString(isbn);

  // For backwards compatibility:
  // isISBN(str [, version]), i.e. `options` could be used as argument for the legacy `version`
  const version = String((options !== null && typeof options === 'object' ? options.version : undefined) || options);

  if (!((options !== null && typeof options === 'object' ? options.version : undefined) || options)) {
    return isISBN(isbn, { version: 10 }) || isISBN(isbn, { version: 13 });
  }

  const sanitizedIsbn = isbn.replace(/[\s-]+/g, '');

  let checksum = 0;

  if (version === '10') {
    if (!possibleIsbn10.test(sanitizedIsbn)) {
      return false;
    }

    for (let i = 0; i < Number(version) - 1; i++) {
      checksum += (i + 1) * Number(sanitizedIsbn.charAt(i));
    }

    if (sanitizedIsbn.charAt(9) === 'X') {
      checksum += 10 * 10;
    } else {
      checksum += 10 * Number(sanitizedIsbn.charAt(9));
    }

    if ((checksum % 11) === 0) {
      return true;
    }
  } else if (version === '13') {
    if (!possibleIsbn13.test(sanitizedIsbn)) {
      return false;
    }

    for (let i = 0; i < 12; i++) {
      checksum += factor[i % 2] * Number(sanitizedIsbn.charAt(i));
    }

    if (Number(sanitizedIsbn.charAt(12)) - ((10 - (checksum % 10)) % 10) === 0) {
      return true;
    }
  }

  return false;
}
