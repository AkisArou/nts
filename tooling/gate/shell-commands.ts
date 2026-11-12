// Literal shell command words, including commands inside substitutions.
// Quoted arguments and heredoc data cannot turn prose into a command.
export type ShellCommand={name:string;start:number};
export type ShellCommands={commands:ShellCommand[];data:{start:number;end:number}[]};

export function shellCommands(source:string):ShellCommands {
  const commands:ShellCommand[]=[],data:ShellCommands['data']=[];
  const prefixes=new Set(['if','then','elif','else','while','until','do','!','time','command','exec','builtin']);
  type Here={delimiter:string;quoted:boolean;tabs:boolean};
  function substitutions(start:number,end:number):void {
    for(let i=start;i<end;){
      const c=source[i];
      if(c==='\\'){i+=2;continue;}
      if(source.startsWith('$(',i)){i=scan(i+2,end,')');continue;}
      if(c==='`'){i=scan(i+1,end,'`');continue;}
      i++;
    }
  }
  function scan(start:number,end:number,stop?:')'|'`'):number {
    let i=start,command=true,word='',wordStart=start,dynamic=false,redirect=false,depth=0;
    const pending:Here[]=[];
    const finish=()=>{
      if(!word&&!dynamic)return;
      if(redirect)redirect=false;
      else if(command){
        if(!dynamic&&(/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)||prefixes.has(word))){/* The command follows. */}
        else {if(!dynamic)commands.push({name:word,start:wordStart});command=false;}
      }
      word='';dynamic=false;
    };
    const begin=()=>{if(!word&&!dynamic)wordStart=i;};
    while(i<end){
      const c=source[i]!;
      if(c==='\\'){begin();if(source[i+1]!=='\n')word+=source[i+1]??'';i+=2;continue;}
      if(c==='\''||c==='"'){
        begin();const quote=c;i++;
        while(i<end&&source[i]!==quote){
          if(quote==='"'&&source[i]==='\\'){word+=source[i+1]??'';i+=2;continue;}
          if(quote==='"'&&source.startsWith('$(',i)){dynamic=true;i=scan(i+2,end,')');continue;}
          if(quote==='"'&&source[i]==='`'){dynamic=true;i=scan(i+1,end,'`');continue;}
          if(quote==='"'&&source[i]==='$')dynamic=true;
          word+=source[i]!;i++;
        }
        i++;continue;
      }
      if(source.startsWith('$(',i)){begin();dynamic=true;i=scan(i+2,end,')');continue;}
      if(c==='`'){
        if(stop==='`'){finish();return i+1;}
        begin();dynamic=true;i=scan(i+1,end,'`');continue;
      }
      if(c==='#'&&!word&&!dynamic){while(i<end&&source[i]!=='\n')i++;continue;}
      if(c==='<'||c==='>'){
        if(/^\d+$/.test(word))word='';else finish();
        if(source.startsWith('<<',i)&&source[i+2]!=='<'){
          i+=2;const tabs=source[i]==='-';if(tabs)i++;
          while(i<end&&/[ \t]/.test(source[i]!))i++;
          let delimiter='',quoted=false;
          while(i<end&&!/[\s;|&<>]/.test(source[i]!)){
            const q=source[i]!;
            if(q==='\''||q==='"'){
              quoted=true;i++;
              while(i<end&&source[i]!==q){if(source[i]==='\\'&&q==='"'&&i+1<end)i++;delimiter+=source[i++]!;}
              i++;
            }else if(q==='\\'){quoted=true;i++;delimiter+=source[i++]??'';}
            else delimiter+=source[i++]!;
          }
          pending.push({delimiter,quoted,tabs});
        }else {i++;while(i<end&&source[i]===c)i++;redirect=true;}
        continue;
      }
      if(c==='\n'){
        finish();command=true;i++;
        for(const here of pending.splice(0)){
          const body=i;let bodyEnd=end;
          while(i<end){
            const newline=source.indexOf('\n',i),lineEnd=newline<0?end:Math.min(end,newline);
            const line=source.slice(i,lineEnd),value=here.tabs?line.replace(/^\t+/,''):line;
            if(value===here.delimiter){bodyEnd=i;i=lineEnd+(lineEnd<end?1:0);break;}
            i=lineEnd+(lineEnd<end?1:0);
          }
          if(here.quoted)data.push({start:body,end:bodyEnd});
          else substitutions(body,bodyEnd);
        }
        continue;
      }
      if(/\s/.test(c)){finish();i++;continue;}
      if(!redirect&&/[;&|(){}]/.test(c)){
        finish();
        if(c===')'&&stop===')'&&depth===0)return i+1;
        if(c==='(')depth++;else if(c===')')depth--;
        command=true;i++;continue;
      }
      begin();if(c==='$')dynamic=true;word+=c;i++;
    }
    finish();return i;
  }
  scan(0,source.length);
  return {commands:commands.sort((a,b)=>a.start-b.start),data};
}
