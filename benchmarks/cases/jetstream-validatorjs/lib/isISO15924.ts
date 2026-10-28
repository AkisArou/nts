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
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isISO15924.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import assertString from './util/assertString.ts';

// from https://www.unicode.org/iso15924/iso15924-codes.html
const validISO15924Codes = new Set([
  'Adlm', 'Afak', 'Aghb', 'Ahom', 'Arab', 'Aran', 'Armi', 'Armn', 'Avst',
  'Bali', 'Bamu', 'Bass', 'Batk', 'Beng', 'Bhks', 'Blis', 'Bopo', 'Brah', 'Brai', 'Bugi', 'Buhd',
  'Cakm', 'Cans', 'Cari', 'Cham', 'Cher', 'Chis', 'Chrs', 'Cirt', 'Copt', 'Cpmn', 'Cprt', 'Cyrl', 'Cyrs',
  'Deva', 'Diak', 'Dogr', 'Dsrt', 'Dupl',
  'Egyd', 'Egyh', 'Egyp', 'Elba', 'Elym', 'Ethi',
  'Gara', 'Geok', 'Geor', 'Glag', 'Gong', 'Gonm', 'Goth', 'Gran', 'Grek', 'Gujr', 'Gukh', 'Guru',
  'Hanb', 'Hang', 'Hani', 'Hano', 'Hans', 'Hant', 'Hatr', 'Hebr', 'Hira', 'Hluw', 'Hmng', 'Hmnp', 'Hrkt', 'Hung',
  'Inds', 'Ital',
  'Jamo', 'Java', 'Jpan', 'Jurc',
  'Kali', 'Kana', 'Kawi', 'Khar', 'Khmr', 'Khoj', 'Kitl', 'Kits', 'Knda', 'Kore', 'Kpel', 'Krai', 'Kthi',
  'Lana', 'Laoo', 'Latf', 'Latg', 'Latn', 'Leke', 'Lepc', 'Limb', 'Lina', 'Linb', 'Lisu', 'Loma', 'Lyci', 'Lydi',
  'Mahj', 'Maka', 'Mand', 'Mani', 'Marc', 'Maya', 'Medf', 'Mend', 'Merc', 'Mero', 'Mlym', 'Modi', 'Mong', 'Moon', 'Mroo', 'Mtei', 'Mult', 'Mymr',
  'Nagm', 'Nand', 'Narb', 'Nbat', 'Newa', 'Nkdb', 'Nkgb', 'Nkoo', 'Nshu',
  'Ogam', 'Olck', 'Onao', 'Orkh', 'Orya', 'Osge', 'Osma', 'Ougr',
  'Palm', 'Pauc', 'Pcun', 'Pelm', 'Perm', 'Phag', 'Phli', 'Phlp', 'Phlv', 'Phnx', 'Plrd', 'Piqd', 'Prti', 'Psin',
  'Qaaa', 'Qaab', 'Qaac', 'Qaad', 'Qaae', 'Qaaf', 'Qaag', 'Qaah', 'Qaai', 'Qaaj', 'Qaak', 'Qaal', 'Qaam', 'Qaan', 'Qaao', 'Qaap', 'Qaaq', 'Qaar', 'Qaas', 'Qaat', 'Qaau', 'Qaav', 'Qaaw', 'Qaax', 'Qaay', 'Qaaz', 'Qaba', 'Qabb', 'Qabc', 'Qabd', 'Qabe', 'Qabf', 'Qabg', 'Qabh', 'Qabi', 'Qabj', 'Qabk', 'Qabl', 'Qabm', 'Qabn', 'Qabo', 'Qabp', 'Qabq', 'Qabr', 'Qabs', 'Qabt', 'Qabu', 'Qabv', 'Qabw', 'Qabx',
  'Ranj', 'Rjng', 'Rohg', 'Roro', 'Runr',
  'Samr', 'Sara', 'Sarb', 'Saur', 'Sgnw', 'Shaw', 'Shrd', 'Shui', 'Sidd', 'Sidt', 'Sind', 'Sinh', 'Sogd', 'Sogo', 'Sora', 'Soyo', 'Sund', 'Sunu', 'Sylo', 'Syrc', 'Syre', 'Syrj', 'Syrn',
  'Tagb', 'Takr', 'Tale', 'Talu', 'Taml', 'Tang', 'Tavt', 'Tayo', 'Telu', 'Teng', 'Tfng', 'Tglg', 'Thaa', 'Thai', 'Tibt', 'Tirh', 'Tnsa', 'Todr', 'Tols', 'Toto', 'Tutg',
  'Ugar',
  'Vaii', 'Visp', 'Vith',
  'Wara', 'Wcho', 'Wole',
  'Xpeo', 'Xsux',
  'Yezi', 'Yiii',
  'Zanb', 'Zinh', 'Zmth', 'Zsye', 'Zsym', 'Zxxx', 'Zyyy', 'Zzzz',
]);

export default function isISO15924(str: string) {
  assertString(str);
  return validISO15924Codes.has(str);
}

export const ScriptCodes = validISO15924Codes;
