// Syntax-only checks against Git-index bytes. Never executes the checked jobs.
import {execFileSync} from 'node:child_process';
const git=(...args)=>execFileSync('git',args,{maxBuffer:32*1024*1024});
const files=git('ls-files','-z').toString().split('\0').filter(Boolean);
let javascript=0,shell=0;
for(const path of files){
  if(!/\.(?:mjs|js|sh)$/.test(path))continue;
  const input=git('show',`:${path}`);
  if(path.endsWith('.sh')){
    execFileSync(process.env.CAMPUS_BASH??'bash',['-n'],{input,stdio:['pipe','pipe','pipe']});shell++;
  }else{
    execFileSync(process.execPath,['--input-type=module','--check'],{input,stdio:['pipe','pipe','pipe']});javascript++;
  }
}
console.log(JSON.stringify({javascript,shell,status:'PASS',jobsExecuted:0}));
