#!/usr/bin/env python3
"""Extract rebuild-inputs.tar.zst beside this script, then run this in that directory.
Builds fixed-iteration C/LLVM executables from retained source, never from scratch objects.
Pass --icu4x to also build the pinned reference (requires cargo registry access).
The printed nanoseconds are a correctness smoke only: use with-lock/CPU4 for measurements.
"""
from pathlib import Path
import subprocess,sys,json,time
root=Path(__file__).resolve().parent/'rebuild-inputs';out=root.parent/'rebuilt';out.mkdir(exist_ok=True)
flags=['-O2','-ffp-contract=off','-fno-math-errno','-flto=thin','-march=x86-64-v3','-falign-loops=32','-Wall','-Wextra','-Werror'];link=flags+['-Wl,-plugin-opt=-align-loops=32'];commands=[];expected=json.loads((root.parent/'expected-checksums.json').read_text())
def run(args):
 args=[str(a)for a in args]
 while int(next(v.split()[1]for v in Path('/proc/meminfo').read_text().splitlines()if v.startswith('MemAvailable:')))*1024<14*2**30:time.sleep(5)
 commands.append(args)
 if args[0].startswith(str(out)):
  result=subprocess.run(args,check=True,capture_output=True,text=True);print(result.stdout,end='');case=max((k for k in expected if Path(args[0]).name.startswith(k+'-')),key=len);assert result.stdout.split()[2]==expected[case],(args[0],result.stdout,expected[case])
 else:subprocess.run(args,check=True)
def compile(src,obj,kind,folder):
 run(['clang++'if kind=='cpp'else'clang',*flags,*(['-std=c++20']if kind=='cpp'else['-std=c11']if kind=='c'else['-x','ir','-w']),'-DNTS_PROVIDER_RC','-I',folder,'-I',root/'common','-c',src,'-o',obj])
compile(root/'fixed-main.cpp',out/'main.o','cpp',root/'fused')
for arm in ['main','scalar','fused']:
 folder=root/arm
 for unit in ['nts_runtime','nts_unicode']:compile(folder/(unit+'.c'),out/(arm+'-'+unit+'.o'),'c',folder)
 for case in ['case-convert','case-convert-unchanged','case-convert-greek']:
  driver=out/(arm+'-'+case+'-driver.o');compile(folder/(case+'.driver.cpp'),driver,'cpp',folder)
  for backend,suffix,kind in [('c','.specialized.c','c'),('llvm','.specialized.ll','ir')]:
   program=out/(arm+'-'+case+'-'+backend+'.o');compile(folder/(case+suffix),program,kind,folder);runtime=[out/(arm+'-nts_runtime.o'),out/(arm+'-nts_unicode.o')];objects=[driver,out/'main.o']+([program]+runtime if backend=='c'else runtime+[program]);binary=out/(case+'-'+arm+'-'+backend);run(['clang++',*link,*objects,'-o',binary,'-lm']);run([binary,'10'])
if '--icu4x'in sys.argv:
 ref=root/'icu4x';run(['cargo','build','--release','--manifest-path',ref/'Cargo.toml']);compile(ref/'nts_unicode_icu4x.c',out/'icu-unicode.o','c',root/'fused')
 for backend in ['c','llvm']:
  objects=[out/'fused-case-convert-greek-driver.o',out/'main.o',out/'fused-nts_runtime.o',out/'icu-unicode.o',out/('fused-case-convert-greek-'+backend+'.o')];binary=out/('case-convert-greek-icu-integrated-'+backend);run(['clang++',*link,*objects,'-o',binary,'-lm',ref/'target/release/libunicode_icu4x_reference.a','-ldl','-lpthread','-lrt','-lutil','-lgcc_s']);run([binary,'10'])
(root.parent/'rebuilt-commands.json').write_text(json.dumps(commands,indent=2)+'\n')
