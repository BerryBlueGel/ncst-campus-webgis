// Whitelisted, loopback-only review server. Never serves credentials or arbitrary project files.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const three=path.join(root,'web/node_modules/three');
const qualityV002=process.argv.includes('--quality-v002');
const heightV003=process.argv.includes('--height-v003');
const port=heightV003?5186:qualityV002?5185:5184;
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');let filename;
if(url.pathname==='/')filename=path.join(root,'reference/buildings/other_areas_detail_v001/review.html');
else if(url.pathname==='/review-presentation.mjs')filename=path.join(root,'reference/buildings/other_areas_detail_v001/review-presentation.mjs');
else if(url.pathname==='/review-performance.mjs')filename=path.join(root,'reference/buildings/other_areas_detail_v001/review-performance.mjs');
else if(url.pathname==='/model.glb')filename=path.join(root,'output',heightV003?'campus_detail_preview_v003.glb':qualityV002?'campus_detail_preview_v002.glb':'campus_detail_preview_v001.glb');
else if(['/three/three.module.js','/three/three.core.js'].includes(url.pathname))filename=path.join(three,'build',path.basename(url.pathname));
else if(url.pathname.startsWith('/addons/')){filename=path.resolve(three,'examples/jsm',url.pathname.slice(8));if(!filename.startsWith(path.join(three,'examples/jsm')+path.sep))filename=null;}
else if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
if(!filename||!fs.existsSync(filename)){res.writeHead(404);return res.end('Not found');}
res.setHeader('Content-Type',/\.m?js$/.test(filename)?'text/javascript':filename.endsWith('.glb')?'model/gltf-binary':'text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
// Both display modes are explicit: original cartographic style and depth-writing physical contact inspection.
if((qualityV002||heightV003)&&url.pathname==='/')return res.end(fs.readFileSync(filename,'utf8').replace('全校独立细化预览（非实测，不是线上版本）',heightV003?'全校楼层调整 v003（用户确认层数，米制高度估算）':'全校贴地修正 v002（非实测，不是线上版本）').replace('<title>全校独立细化预览 · 非实测</title>',heightV003?'<title>全校楼层调整 v003 · 高度估算</title>':'<title>全校贴地修正 v002 · 非实测</title>').replace('124个源ID细化 · 12项证据缺口保留 · 楼高/门窗多为占位与示意',heightV003?'39个教学楼体四层 · 53个宿舍楼体五层 · 其余用途不变 · 门窗与米制高度仍为示意':'124个源ID细化 · 12项证据缺口保留 · 楼高/门窗多为占位与示意').replace('const controls=new OrbitControls','const qualityGroundMeshes=[];const controls=new OrbitControls').replace('o.material=Array.isArray(o.material)?cloned:cloned[0];','o.material=Array.isArray(o.material)?cloned:cloned[0];qualityGroundMeshes.push(o);').replace('loadMs:performance.now()-start','groundDepthWrite:qualityGroundMeshes.length>0&&qualityGroundMeshes.every(o=>(Array.isArray(o.material)?o.material:[o.material]).every(m=>m.depthWrite)),loadMs:performance.now()-start').replace('for(const [id,args] of Object.entries(views))',`Object.assign(views,{lansouth:['兰园2号南楼贴地',691.4834,690.0651,80,-110,85],landining:['兰园食堂贴地',678.3795,595.7001,100,-130,90],dmain:['D区1号楼贴地',1404.5482,1605.7140,110,-140,100]});
for(const id of ['lansouth','landining','dmain']){const button=document.createElement('button');button.id=id;button.textContent=views[id][0];document.getElementById('camera').before(button);}
const groundButton=document.createElement('button');groundButton.id='ground-depth';groundButton.textContent='真实地形遮挡：关';document.getElementById('camera').before(groundButton);
groundButton.onclick=()=>{if(!loaded)return;const enabled=!qualityGroundMeshes.every(o=>(Array.isArray(o.material)?o.material:[o.material]).every(m=>m.depthWrite));for(const o of qualityGroundMeshes)for(const m of (Array.isArray(o.material)?o.material:[o.material]))m.depthWrite=enabled;groundButton.textContent='真实地形遮挡：'+(enabled?'开':'关');window.reviewResult.groundDepthWrite=enabled;loop.request();};
for(const [id,args] of Object.entries(views))`));
fs.createReadStream(filename).pipe(res);});
server.listen(port,'127.0.0.1',()=>console.log('Independent review: http://127.0.0.1:'+port+'/'));
