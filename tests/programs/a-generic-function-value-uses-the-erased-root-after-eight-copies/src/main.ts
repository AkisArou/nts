function identity<T>(value:T):T{return value;}
function use<T>(fn:(v:T)=>T, value:T):T{return fn(value);}
class Box0 { constructor(public value:number) {} }
class Box1 { constructor(public value:number) {} }
class Box2 { constructor(public value:number) {} }
class Box3 { constructor(public value:number) {} }
class Box4 { constructor(public value:number) {} }
class Box5 { constructor(public value:number) {} }
class Box6 { constructor(public value:number) {} }
class Box7 { constructor(public value:number) {} }
class Box8 { constructor(public value:number) {} }
class Box9 { constructor(public value:number) {} }
class Box10 { constructor(public value:number) {} }
export function cap(n:number):boolean {
 const b0=new Box0(n+0);
 const v0=use<Box0>(identity,b0);
 const b1=new Box1(n+1);
 const v1=use<Box1>(identity,b1);
 const b2=new Box2(n+2);
 const v2=use<Box2>(identity,b2);
 const b3=new Box3(n+3);
 const v3=use<Box3>(identity,b3);
 const b4=new Box4(n+4);
 const v4=use<Box4>(identity,b4);
 const b5=new Box5(n+5);
 const v5=use<Box5>(identity,b5);
 const b6=new Box6(n+6);
 const v6=use<Box6>(identity,b6);
 const b7=new Box7(n+7);
 const v7=use<Box7>(identity,b7);
 const b8=new Box8(n+8);
 const v8=use<Box8>(identity,b8);
 const b9=new Box9(n+9);
 const v9=use<Box9>(identity,b9);
 const b10=new Box10(n+10);
 const v10=use<Box10>(identity,b10);
return v0===b0 && v0.value===n+0 && v1===b1 && v1.value===n+1 && v2===b2 && v2.value===n+2 && v3===b3 && v3.value===n+3 && v4===b4 && v4.value===n+4 && v5===b5 && v5.value===n+5 && v6===b6 && v6.value===n+6 && v7===b7 && v7.value===n+7 && v8===b8 && v8.value===n+8 && v9===b9 && v9.value===n+9 && v10===b10 && v10.value===n+10;
}
