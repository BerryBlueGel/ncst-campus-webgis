// Inspect staged/committed source, never ignored production secrets or the workspace.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const git=(...args)=>execFileSync('git',args,{maxBuffer:32*1024*1024});
const all=process.argv.includes('--all');
const files=(all?git('ls-files','-z'):git('diff','--cached','--name-only','--diff-filter=ACM','-z')).toString().split('\0').filter(Boolean);
assert.ok(files.length>0,'Nothing staged for publication');
const findings=[];
const binaryAllowed=/^(?:web\/public\/(?:favicon\.ico|branding\/berrybluegel-v1(?:-\d+\.png|\.ico))|docs\/previews\/(?:campus-3d|spatial-analysis|immersive-campus)\.png)$/;
const blocked=/(?:^|\/)(?:node_modules|dist|target|geojson|output|blender|releases|staging|certs|frames|__pycache__)(?:\/|$)|^web\/public\/(?:data|models)\/|\.env(?:\.|$)(?!example$)|\.(?:glb|gltf|blend\d*|geojson|shp|dbf|shx|tiff?|gpkg|sqlite\w*|dump|backup|pem|key|pfx|p12|jks|zip|gz|7z)$/i;
const reviewedManifests=new Set(['CampusAcademicRefinementManifest.json','CampusAcademicRefinementV006Manifest.json','CampusDetailReviewManifest.json','CampusDormitoryCompoundManifest.json','CampusDormitoryShapeManifest.json','CampusShapeReleaseManifest.json','CampusShapeReviewManifest.json'].map(name=>'web/src/gis/three/'+name));
const secretPatterns=[
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16})\b/,
  /\b(?:sk-proj-|sk-ant-)[A-Za-z0-9_-]{20,}/,
  /https?:\/\/[^\s/]+:[^\s/@]+@/,
  /\b(?:password|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{12,}["']/i,
];
let total=0;
for(const path of files){
  if(blocked.test(path))findings.push({path,issue:'Excluded asset/data/config path'});
  if(/^(?:reference|diagnostics)\//.test(path)&&!(/\.(?:mjs|js|html)$/.test(path)||/(?:^|\/)package(?:-lock)?\.json$/.test(path)))findings.push({path,issue:'Only source/HTML and dependency manifests are allowed in reference/diagnostics'});
  if(/Manifest\.json$/.test(path)&&!reviewedManifests.has(path))findings.push({path,issue:'Unreviewed model manifest'});
  const bytes=git('show',`:${path}`);total+=bytes.length;
  if(bytes.length>(binaryAllowed.test(path)?8:1)*1024*1024)findings.push({path,issue:'Unexpected large file'});
  if(binaryAllowed.test(path))continue;
  if(bytes.includes(0)){findings.push({path,issue:'Unexpected binary content'});continue;}
  const lines=bytes.toString('utf8').split(/\r?\n/);
  lines.forEach((line,index)=>{
    const placeholder=path.endsWith('/.env.example')&&/\b(?:REPLACE_WITH_|replace-with-|<choose-)/.test(line);
    if(!placeholder&&secretPatterns.some(pattern=>pattern.test(line)))findings.push({path,line:index+1,issue:'Possible credential: inspect locally, never print matched content'});
    if(/[A-Z]:[\\/]+Users[\\/]/i.test(line))findings.push({path,line:index+1,issue:'Author-machine home path must be made portable'});
  });
}
console.log(JSON.stringify({files:files.length,bytes:total,findings},null,2));
if(findings.length)process.exitCode=1;
