// A complete base lookup keeps inherited physical storage at any depth.
// The controls differ only in the selected class: four bases instead of eighty.
// Main refused the deep byte class's inherited storage and the deep Error constructor as
// having no constructor, even though both shallow controls compiled.
class Bytes0 extends Uint8Array {}
class Bytes1 extends Bytes0 {}
class Bytes2 extends Bytes1 {}
class Bytes3 extends Bytes2 {}
class Bytes4 extends Bytes3 {}
class Bytes5 extends Bytes4 {}
class Bytes6 extends Bytes5 {}
class Bytes7 extends Bytes6 {}
class Bytes8 extends Bytes7 {}
class Bytes9 extends Bytes8 {}
class Bytes10 extends Bytes9 {}
class Bytes11 extends Bytes10 {}
class Bytes12 extends Bytes11 {}
class Bytes13 extends Bytes12 {}
class Bytes14 extends Bytes13 {}
class Bytes15 extends Bytes14 {}
class Bytes16 extends Bytes15 {}
class Bytes17 extends Bytes16 {}
class Bytes18 extends Bytes17 {}
class Bytes19 extends Bytes18 {}
class Bytes20 extends Bytes19 {}
class Bytes21 extends Bytes20 {}
class Bytes22 extends Bytes21 {}
class Bytes23 extends Bytes22 {}
class Bytes24 extends Bytes23 {}
class Bytes25 extends Bytes24 {}
class Bytes26 extends Bytes25 {}
class Bytes27 extends Bytes26 {}
class Bytes28 extends Bytes27 {}
class Bytes29 extends Bytes28 {}
class Bytes30 extends Bytes29 {}
class Bytes31 extends Bytes30 {}
class Bytes32 extends Bytes31 {}
class Bytes33 extends Bytes32 {}
class Bytes34 extends Bytes33 {}
class Bytes35 extends Bytes34 {}
class Bytes36 extends Bytes35 {}
class Bytes37 extends Bytes36 {}
class Bytes38 extends Bytes37 {}
class Bytes39 extends Bytes38 {}
class Bytes40 extends Bytes39 {}
class Bytes41 extends Bytes40 {}
class Bytes42 extends Bytes41 {}
class Bytes43 extends Bytes42 {}
class Bytes44 extends Bytes43 {}
class Bytes45 extends Bytes44 {}
class Bytes46 extends Bytes45 {}
class Bytes47 extends Bytes46 {}
class Bytes48 extends Bytes47 {}
class Bytes49 extends Bytes48 {}
class Bytes50 extends Bytes49 {}
class Bytes51 extends Bytes50 {}
class Bytes52 extends Bytes51 {}
class Bytes53 extends Bytes52 {}
class Bytes54 extends Bytes53 {}
class Bytes55 extends Bytes54 {}
class Bytes56 extends Bytes55 {}
class Bytes57 extends Bytes56 {}
class Bytes58 extends Bytes57 {}
class Bytes59 extends Bytes58 {}
class Bytes60 extends Bytes59 {}
class Bytes61 extends Bytes60 {}
class Bytes62 extends Bytes61 {}
class Bytes63 extends Bytes62 {}
class Bytes64 extends Bytes63 {}
class Bytes65 extends Bytes64 {}
class Bytes66 extends Bytes65 {}
class Bytes67 extends Bytes66 {}
class Bytes68 extends Bytes67 {}
class Bytes69 extends Bytes68 {}
class Bytes70 extends Bytes69 {}
class Bytes71 extends Bytes70 {}
class Bytes72 extends Bytes71 {}
class Bytes73 extends Bytes72 {}
class Bytes74 extends Bytes73 {}
class Bytes75 extends Bytes74 {}
class Bytes76 extends Bytes75 {}
class Bytes77 extends Bytes76 {}
class Bytes78 extends Bytes77 {}
class Bytes79 extends Bytes78 {}
class Bytes80 extends Bytes79 {}

class Failure0 extends TypeError {}
class Failure1 extends Failure0 {}
class Failure2 extends Failure1 {}
class Failure3 extends Failure2 {}
class Failure4 extends Failure3 {}
class Failure5 extends Failure4 {}
class Failure6 extends Failure5 {}
class Failure7 extends Failure6 {}
class Failure8 extends Failure7 {}
class Failure9 extends Failure8 {}
class Failure10 extends Failure9 {}
class Failure11 extends Failure10 {}
class Failure12 extends Failure11 {}
class Failure13 extends Failure12 {}
class Failure14 extends Failure13 {}
class Failure15 extends Failure14 {}
class Failure16 extends Failure15 {}
class Failure17 extends Failure16 {}
class Failure18 extends Failure17 {}
class Failure19 extends Failure18 {}
class Failure20 extends Failure19 {}
class Failure21 extends Failure20 {}
class Failure22 extends Failure21 {}
class Failure23 extends Failure22 {}
class Failure24 extends Failure23 {}
class Failure25 extends Failure24 {}
class Failure26 extends Failure25 {}
class Failure27 extends Failure26 {}
class Failure28 extends Failure27 {}
class Failure29 extends Failure28 {}
class Failure30 extends Failure29 {}
class Failure31 extends Failure30 {}
class Failure32 extends Failure31 {}
class Failure33 extends Failure32 {}
class Failure34 extends Failure33 {}
class Failure35 extends Failure34 {}
class Failure36 extends Failure35 {}
class Failure37 extends Failure36 {}
class Failure38 extends Failure37 {}
class Failure39 extends Failure38 {}
class Failure40 extends Failure39 {}
class Failure41 extends Failure40 {}
class Failure42 extends Failure41 {}
class Failure43 extends Failure42 {}
class Failure44 extends Failure43 {}
class Failure45 extends Failure44 {}
class Failure46 extends Failure45 {}
class Failure47 extends Failure46 {}
class Failure48 extends Failure47 {}
class Failure49 extends Failure48 {}
class Failure50 extends Failure49 {}
class Failure51 extends Failure50 {}
class Failure52 extends Failure51 {}
class Failure53 extends Failure52 {}
class Failure54 extends Failure53 {}
class Failure55 extends Failure54 {}
class Failure56 extends Failure55 {}
class Failure57 extends Failure56 {}
class Failure58 extends Failure57 {}
class Failure59 extends Failure58 {}
class Failure60 extends Failure59 {}
class Failure61 extends Failure60 {}
class Failure62 extends Failure61 {}
class Failure63 extends Failure62 {}
class Failure64 extends Failure63 {}
class Failure65 extends Failure64 {}
class Failure66 extends Failure65 {}
class Failure67 extends Failure66 {}
class Failure68 extends Failure67 {}
class Failure69 extends Failure68 {}
class Failure70 extends Failure69 {}
class Failure71 extends Failure70 {}
class Failure72 extends Failure71 {}
class Failure73 extends Failure72 {}
class Failure74 extends Failure73 {}
class Failure75 extends Failure74 {}
class Failure76 extends Failure75 {}
class Failure77 extends Failure76 {}
class Failure78 extends Failure77 {}
class Failure79 extends Failure78 {}
class Failure80 extends Failure79 {}

export function byteControl(x: number): number {
  const bytes = new Bytes4(4);
  bytes[0] = x;
  return bytes[0] + bytes.length;
}

export function deepBytes(x: number): number {
  const bytes = new Bytes80(4);
  bytes[0] = x;
  return bytes[0] + bytes.length;
}

export function errorControl(x: number): number {
  const error = new Failure4("message");
  return error.message.length + error.name.length + x;
}

export function deepError(x: number): number {
  const error = new Failure80("message");
  return error.message.length + error.name.length + x;
}

