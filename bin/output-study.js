import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {freezeOutputStudy,runOutputStudy} from '../src/output-study-runner.js';
import {summarizeOutputStudy} from '../src/output-study.js';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const [mode,label,pilot,...extra]=process.argv.slice(2);
if(!['calibrate','start','resume','report'].includes(mode)||!/^output-(calibration|formal)-[a-z0-9-]+$/.test(label??'')||extra.length||
 mode==='start'&&!/^output-calibration-[a-z0-9-]+$/.test(pilot??'')||mode!=='start'&&pilot)throw Error('Usage: output-study calibrate <output-calibration-id> | start <output-formal-id> <output-calibration-id> | resume|report <id>');
const directory=path.join(root,'runs',label);
let plan;
if(['calibrate','start'].includes(mode)){
 await fs.mkdir(directory,{mode:0o700});
 plan=await freezeOutputStudy(root,directory,{calibration:mode==='calibrate',calibrationDirectory:pilot?path.join(root,'runs',pilot):null});
}else plan=JSON.parse(await fs.readFile(path.join(directory,'plan.json'),'utf8'));
const print=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(mode==='report'){
 const results=[];for(const position of plan.positions){try{results.push(JSON.parse(await fs.readFile(path.join(directory,position.id,'result.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}}
 print(summarizeOutputStudy(plan,results));
}else{
 print({event:'study-started',directory,calibration:plan.calibration,positions:plan.positions.length,model:plan.model,headroomProfile:plan.headroomProfile});
 const summary=await runOutputStudy(root,directory,plan,{onProgress:print});print(summary);
 if(!summary.completed)process.exitCode=1;
}
