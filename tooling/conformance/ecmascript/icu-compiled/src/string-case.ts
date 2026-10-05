// Supplementary ABI/lifetime witness. Original Test262 remains the semantic
// corpus; these cases exercise managed UTF-16 transport and output growth.
export function stringCaseDigest(
  mapCase: (locale: string, value: string, upper: boolean) => string,
): string {
  if (mapCase("tr", "Iİıi", false) !== "ıiıi" || mapCase("az", "Iİıi", true) !== "IİIİ")
    throw new Error("Turkic case mapping differs");
  if (
    mapCase("lt", "I\u0301", false) !== "i\u0307\u0301" ||
    mapCase("lt", "i\u0323\u0307", true) !== "I\u0323"
  )
    throw new Error("Lithuanian context differs");
  if (
    mapCase("und", "ΟΣ", false) !== "ος" ||
    mapCase("el", "άδικος", true) !== "ΑΔΙΚΟΣ" ||
    mapCase("hy", "և", true) !== "ԵՎ" ||
    mapCase("und", "և", true) !== "ԵՒ"
  )
    throw new Error("Root/Greek/Armenian mapping differs");
  if (
    mapCase("und", "\ud800A\0𐐀\udfff", false) !== "\ud800a\0𐐨\udfff" ||
    mapCase("tr", "i\0\ud800𐐨\udfff", true) !== "İ\0\ud800𐐀\udfff"
  )
    throw new Error("UTF-16 units changed in transport");
  if (
    mapCase("und", "", true) !== "" ||
    mapCase("und", "a".repeat(128), true) !== "A".repeat(128) ||
    mapCase("und", "ß".repeat(129), true) !== "SS".repeat(129) ||
    mapCase("lt", "I\u0301".repeat(1024), false) !== "i\u0307\u0301".repeat(1024)
  )
    throw new Error("Case mapping output growth differs");
  // Exercise both temporary-output branches repeatedly under RC leak checks.
  for (let index = 0; index < 10000; index++) {
    if (
      mapCase("tr", "I\u0307", false) !== "i" ||
      mapCase("und", "ß".repeat(129), true).length !== 258
    )
      throw new Error("Repeated case mapping differs");
  }
  return "case-mapping:context:utf16:growth:20000";
}
