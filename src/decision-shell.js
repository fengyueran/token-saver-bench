import path from 'node:path';import {homedir} from 'node:os';import {mkdir,lstat,readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {assertScenarioState} from './scenario-state.js';
export const quoteDecisionShell=value=>"'"+value.replaceAll("'","'\\''")+"'";

export async function prepareDecisionShell(workspace,state){
 if(![workspace,state].every(p=>typeof p==='string'&&path.isAbsolute(p)&&path.resolve(p)===p)||workspace===state||workspace.startsWith(state+path.sep)||state.startsWith(workspace+path.sep))throw Error('Independent absolute decision shell paths required');
 if([path.join(homedir(),'.codex'),process.env.CODEX_HOME].filter(Boolean).some(root=>state===root||state.startsWith(root+path.sep)))throw Error('User configuration is not a private shell target');
 await assertScenarioState(state);const info=await lstat(workspace);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Real workspace required');
 const bin=path.join(state,'bin');await mkdir(bin,{mode:0o700,recursive:true});const binInfo=await lstat(bin);if(!binInfo.isDirectory()||binInfo.isSymbolicLink()||(binInfo.mode&0o777)!==0o700)throw Error('Private real shell bin required');
 const prefix=bin+path.delimiter+path.join(workspace,'.venv/bin'),profile=path.join(state,'.zprofile'),body=`export PATH=${quoteDecisionShell(prefix)}:"$PATH"\n`;
 const exists=await lstat(profile).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(exists){if(!exists.isFile()||exists.isSymbolicLink()||(await readFile(profile,'utf8'))!==body)throw Error('Private shell profile mismatch');}
 else await writeFile(profile,body,{flag:'wx',mode:0o600});
 const env={PATH:prefix+path.delimiter+(process.env.PATH??''),ZDOTDIR:state};
 return {env,args:['-c',`shell_environment_policy.set.PATH=${JSON.stringify(env.PATH)}`,'-c',`shell_environment_policy.set.ZDOTDIR=${JSON.stringify(env.ZDOTDIR)}`],
  evidence:{policy:'same-private-zsh-login-profile-all-new-arms',profile,profileSha256:createHash('sha256').update(body).digest('hex'),pythonPreference:'workspace .venv/bin before inherited PATH',globalConfigurationModified:false}};
}

export function decisionEnvironmentOverrides(env){
 const keys=['CODEX_HOME','PATH','ZDOTDIR','PONYTAIL_DEFAULT_MODE','CLAUDE_CONFIG_DIR','XDG_CONFIG_HOME','CODEGRAPH_TELEMETRY','CODEGRAPH_NO_DAEMON','CODEGRAPH_NO_WATCH','CODEGRAPH_NO_UPDATE_CHECK','CODEGRAPH_NO_INSTALL_REFRESH','CODEGRAPH_NO_PROMPT_HOOK','DO_NOT_TRACK'];
 return Object.fromEntries(Object.entries(env).filter(([key])=>keys.includes(key)));
}
