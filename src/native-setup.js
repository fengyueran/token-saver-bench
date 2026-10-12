import path from 'node:path';import {homedir} from 'node:os';import {execFileSync} from 'node:child_process';
import {mkdir,lstat,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import {execute} from './process.js';import {assertScenarioState} from './scenario-state.js';
const commits={ponytail:'e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156',caveman:'2fd153c67988e980fb0b2455c90832159a6a5a25'};

async function absent(destination){
 const exists=await lstat(destination).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
 if(exists)throw Error('Native installation already exists');
}

async function compareInstalled(source,installed){
 let count=0;
 for(const entry of await readdir(source,{withFileTypes:true})){
  if(entry.name==='.git')continue;
  const from=path.join(source,entry.name),to=path.join(installed,entry.name);
  if(entry.isDirectory())count+=await compareInstalled(from,to);
  else if(entry.isFile()){
   const info=await lstat(to);
   if(!info.isFile()||info.isSymbolicLink()||!(await readFile(from)).equals(await readFile(to)))throw Error('Installed plugin source mismatch');
   count++;
  }else throw Error('Unsupported plugin source entry');
 }
 return count;
}

async function installPonytail(source,state){
 const marketplace=path.join(state,'native-marketplace');await absent(marketplace);
 await absent(path.join(state,'config.toml'));
 await mkdir(path.join(marketplace,'.claude-plugin'),{recursive:true});
 const target=path.join(marketplace,'plugins/ponytail');
 await cp(source,target,{recursive:true,filter:file=>!path.relative(source,file).split(path.sep).includes('.git')});
 await writeFile(path.join(marketplace,'.claude-plugin/marketplace.json'),JSON.stringify({name:'ponytail-bench-pinned',owner:{name:'local-benchmark'},plugins:[{name:'ponytail',source:'./plugins/ponytail'}]}));
 const env={...process.env,CODEX_HOME:state};
 for(const args of [['plugin','marketplace','add',marketplace,'--json'],['plugin','add','ponytail@ponytail-bench-pinned','--json']]){
  const result=await execute('codex',args,{cwd:state,env,timeoutMs:null});
  if(result.code!==0||result.inputError)throw Error('Private native plugin installation failed');
 }
 const installed=path.join(state,'plugins/cache/ponytail-bench-pinned/ponytail/4.10.0');
 const metadata=JSON.parse(await readFile(path.join(installed,'.claude-plugin/plugin.json'),'utf8'));
 if(metadata.version!=='4.10.0')throw Error('Pinned plugin version changed');
 return {version:metadata.version,installedFilesMatchSource:await compareInstalled(source,installed),installedPath:installed};
}

export async function prepareNativeInstructionArm({root,workspace,state,arm}){
 if(!commits[arm])throw Error('Unknown native instruction arm');
 if(![root,workspace,state].every(p=>typeof p==='string'&&path.isAbsolute(p)&&path.resolve(p)===p)||
    state===path.join(homedir(),'.codex')||path.dirname(workspace)!==path.dirname(state))throw Error('Independent absolute native paths required');
 await assertScenarioState(state);
 const info=await lstat(workspace);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Real workspace required');
 const source=path.join(root,'.cache/tools',arm);
 if(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==commits[arm])throw Error('Native source commit changed');
 if(execFileSync('git',['-C',source,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw Error('Native source has tracked modifications');
 const start=performance.now();let prepared;
 if(arm==='ponytail')prepared=await installPonytail(source,state);
 else{
  const destination=path.join(workspace,'.agents/skills/caveman');await absent(destination);
  await mkdir(path.dirname(destination),{recursive:true});
  await cp(path.join(source,'skills/caveman'),destination,{recursive:true,errorOnExist:true,force:false});
  prepared={skillPath:path.join(destination,'SKILL.md'),skill:await readFile(path.join(destination,'SKILL.md'),'utf8')};
 }
 return {...prepared,arm,sourceCommit:commits[arm],setupDurationMs:performance.now()-start,
  setupScope:'fixed source already downloaded and built; private installation only',globalConfigurationModified:false,humanInterventionMs:null};
}
