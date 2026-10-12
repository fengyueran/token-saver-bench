import path from 'node:path';import {lstat,readdir,readFile,writeFile,mkdir,rm,cp} from 'node:fs/promises';
const testPath=name=>name.split(path.sep).includes('__tests__')||/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);

/** New-task acceptance keeps the fixed project's colocated tests, never the model's tests. */
export async function transplantDecisionSource(source,target){
 if(![source,target].every(p=>typeof p==='string'&&path.isAbsolute(p))||source===target)throw Error('Separate absolute source directories required');
 const preserved=[];
 async function collect(directory,prefix=''){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const relative=path.join(prefix,entry.name),file=path.join(directory,entry.name);
   if(entry.isSymbolicLink())throw Error('Source transplant does not accept symbolic links');
   if(entry.isDirectory())await collect(file,relative);
   else if(testPath(relative))preserved.push({relative,body:await readFile(file)});
  }
 }
 for(const directory of [source,target]){const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Real source directories required');}
 await collect(target);
 await rm(target,{recursive:true});
 await cp(source,target,{recursive:true,filter:async file=>{
  if((await lstat(file)).isSymbolicLink())throw Error('Source transplant does not accept symbolic links');
  return !testPath(path.relative(source,file));
 }});
 for(const {relative,body}of preserved){await mkdir(path.dirname(path.join(target,relative)),{recursive:true});await writeFile(path.join(target,relative),body);}
 return {retainedOriginalTests:preserved.length,modelTestsTransplanted:false};
}
