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
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isLocale.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import assertString from './util/assertString.ts';

/*
  = 3ALPHA              ; selected ISO 639 codes
    *2("-" 3ALPHA)      ; permanently reserved
 */
const extlang = '([A-Za-z]{3}(-[A-Za-z]{3}){0,2})';

/*
  = 2*3ALPHA            ; shortest ISO 639 code
    ["-" extlang]       ; sometimes followed by
                        ; extended language subtags
  / 4ALPHA              ; or reserved for future use
  / 5*8ALPHA            ; or registered language subtag
 */
const language = `(([a-zA-Z]{2,3}(-${extlang})?)|([a-zA-Z]{5,8}))`;

/*
  = 4ALPHA              ; ISO 15924 code
 */
const script = '([A-Za-z]{4})';

/*
  = 2ALPHA              ; ISO 3166-1 code
  / 3DIGIT              ; UN M.49 code
 */
const region = '([A-Za-z]{2}|\\d{3})';

/*
  = 5*8alphanum         ; registered variants
  / (DIGIT 3alphanum)
 */
const variant = '([A-Za-z0-9]{5,8}|(\\d[A-Z-a-z0-9]{3}))';

/*
  = DIGIT               ; 0 - 9
  / %x41-57             ; A - W
  / %x59-5A             ; Y - Z
  / %x61-77             ; a - w
  / %x79-7A             ; y - z
 */
const singleton = '(\\d|[A-W]|[Y-Z]|[a-w]|[y-z])';

/*
  = singleton 1*("-" (2*8alphanum))
                        ; Single alphanumerics
                        ; "x" reserved for private use
 */
const extension = `(${singleton}(-[A-Za-z0-9]{2,8})+)`;

/*
  = "x" 1*("-" (1*8alphanum))
 */
const privateuse = '(x(-[A-Za-z0-9]{1,8})+)';

// irregular tags do not match the 'langtag' production and would not
// otherwise be considered 'well-formed'. These tags are all valid, but
// most are deprecated in favor of more modern subtags or subtag combination

const irregular = '((en-GB-oed)|(i-ami)|(i-bnn)|(i-default)|(i-enochian)|' +
    '(i-hak)|(i-klingon)|(i-lux)|(i-mingo)|(i-navajo)|(i-pwn)|(i-tao)|' +
    '(i-tay)|(i-tsu)|(sgn-BE-FR)|(sgn-BE-NL)|(sgn-CH-DE))';

// regular tags match the 'langtag' production, but their subtags are not
// extended language or variant subtags: their meaning is defined by
// their registration and all of these are deprecated in favor of a more
// modern subtag or sequence of subtags

const regular = '((art-lojban)|(cel-gaulish)|(no-bok)|(no-nyn)|(zh-guoyu)|' +
    '(zh-hakka)|(zh-min)|(zh-min-nan)|(zh-xiang))';

/*
  = irregular           ; non-redundant tags registered
  / regular             ; during the RFC 3066 era

 */
const grandfathered = `(${irregular}|${regular})`;

/*
  RFC 5646 defines delimitation of subtags via a hyphen:

      "Subtag" refers to a specific section of a tag, delimited by a
      hyphen, such as the subtags 'zh', 'Hant', and 'CN' in the tag "zh-
      Hant-CN".  Examples of subtags in this document are enclosed in
      single quotes ('Hant')

  However, we need to add "_" to maintain the existing behaviour.
 */
const delimiter = '(-|_)';

/*
  = language
    ["-" script]
    ["-" region]
    *("-" variant)
    *("-" extension)
    ["-" privateuse]
 */
const langtag = `${language}(${delimiter}${script})?(${delimiter}${region})?(${delimiter}${variant})*(${delimiter}${extension})*(${delimiter}${privateuse})?`;

/*
  Regex implementation based on BCP RFC 5646
  Tags for Identifying Languages
  https://www.rfc-editor.org/rfc/rfc5646.html
 */
const languageTagRegex = new RegExp(`(^${privateuse}$)|(^${grandfathered}$)|(^${langtag}$)`);

export default function isLocale(str: string) {
  assertString(str);
  return languageTagRegex.test(str);
}
