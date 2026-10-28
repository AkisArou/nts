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
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isDataURI.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import assertString from './util/assertString.ts';
import required from './util/required.ts';

const validMediaType = /^[a-z]+\/[a-z0-9\-\+\._]+$/i;

const validAttribute = /^[a-z\-]+=[a-z0-9\-]+$/i;

const validData = /^[a-z0-9!\$&'\(\)\*\+,;=\-\._~:@\/\?%\s]*$/i;

export default function isDataURI(str: string) {
  assertString(str);
  let data = str.split(',');
  if (data.length < 2) {
    return false;
  }
  const attributes = required(data.shift()).trim().split(';');
  const schemeAndMediaType = required(attributes.shift());
  if (schemeAndMediaType.slice(0, 5) !== 'data:') {
    return false;
  }
  const mediaType = schemeAndMediaType.slice(5);
  if (mediaType !== '' && !validMediaType.test(mediaType)) {
    return false;
  }
  for (let i = 0; i < attributes.length; i++) {
    if (
      !(i === attributes.length - 1 && attributes[i].toLowerCase() === 'base64') &&
      !validAttribute.test(attributes[i])
    ) {
      return false;
    }
  }
  for (let i = 0; i < data.length; i++) {
    if (!validData.test(data[i])) {
      return false;
    }
  }
  return true;
}
