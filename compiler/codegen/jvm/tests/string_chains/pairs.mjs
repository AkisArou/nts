const values=[0,-0,17.5,NaN,Infinity,-Infinity,1e21,1e-7];
for(const [i,value] of values.entries())for(const defined of [false,true])
 console.log(`${i}/${defined}=prefix:${defined?String(value):"no"}`);
