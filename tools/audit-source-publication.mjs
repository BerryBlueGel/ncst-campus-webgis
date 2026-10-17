// Inspect the Git index, never the ignored production secrets or entire workspace.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const git=(...args)=>execFileSync('git',args,{maxBuffer:32*1024*1024});
const files=git('diff','--cached','--name-only','--diff-filter=ACM','-z').toString().split('\0').filter(Boolean);
assert.ok(files.length>0,'Nothing staged for publication');
const findings=[];
const binaryAllowed=/^web\/public\/(?:favicon\.ico|branding\/berrybluegel-v1(?:-\d+\.png|\.ico))$/;
const blocked=/(?:^|\/)(?:node_modules|dist|target|geojson|reference|output|blender|releases|staging|certs|diagnostics|frames)(?:\/|$)|^web\/public\/(?:data|models)\/|\.env(?:\.|$)(?!example$)|\.(?:glb|gltf|blend\d*|geojson|shp|dbf|shx|tiff?|gpkg|sqlite\w*|dump|backup|pem|key|pfx|p12|jks|zip|gz|7z)$/i;
const secretPatterns=[
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16})\b/,
  /\b(?:sk-proj-|sk-ant-)[A-Za-z0-9_-]{20,}/,
  /https?:\/\/[^\s/]+:[^\s/@]+@/,
  /\b(?:password|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{12,}["']/i,
];
let total=0;
for(const path of files){
  if(blocked.test(path)||/Manifest\.json$/.test(path))findings.push({path,issue:'Excluded asset/data/config path'});
  const bytes=git('show',`:${path}`);total+=bytes.length;
  if(bytes.length>1024*1024)findings.push({path,issue:'Unexpected file larger than 1 MiB'});
  if(binaryAllowed.test(path))continue;
  if(bytes.includes(0)){findings.push({path,issue:'Unexpected binary content'});continue;}
  const lines=bytes.toString('utf8').split(/\r?\n/);
  lines.forEach((line,index)=>{
    if(secretPatterns.some(pattern=>pattern.test(line)))findings.push({path,line:index+1,issue:'Possible credential: inspect locally, never print matched content'});
  });
}
console.log(JSON.stringify({files:files.length,bytes:total,findings},null,2));
if(findings.length)process.exitCode=1;
