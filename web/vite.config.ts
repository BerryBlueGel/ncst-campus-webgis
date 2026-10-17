import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import {createReadStream,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export default defineConfig(({command})=>({
  plugins: [vue(),...(command==='serve'&&(process.env.VITE_CAMPUS_DETAIL_REVIEW==='1'||['1','2','3'].includes(process.env.VITE_CAMPUS_SHAPE_REVIEW??''))?[{
    name:'loopback-campus-candidate',configureServer(server:import('vite').ViteDevServer){
      server.middlewares.use((req,res,next)=>{
        const pathname=new URL(req.url??'/','http://127.0.0.1').pathname;
        if(!pathname.startsWith('/__campus_review/'))return next();
        if(pathname!=='/__campus_review/model.glb'||!['GET','HEAD'].includes(req.method??'')){res.statusCode=404;return res.end('Not found');}
        const gzip=/\bgzip\b/.test(req.headers['accept-encoding']??'');
        const filename=process.env.VITE_CAMPUS_SHAPE_REVIEW==='3'?'campus_shape_review_v003.glb':process.env.VITE_CAMPUS_SHAPE_REVIEW==='2'?'campus_shape_review_v002.glb':process.env.VITE_CAMPUS_SHAPE_REVIEW==='1'?'campus_shape_review_v001.glb':'campus_detail_release_v004.glb';
        const path=fileURLToPath(new URL('../output/'+filename+(gzip?'.gz':''),import.meta.url));
        try {res.setHeader('Content-Type','model/gltf-binary');res.setHeader('Vary','Accept-Encoding');res.setHeader('Cache-Control','no-store');
          if(gzip)res.setHeader('Content-Encoding','gzip');res.setHeader('Content-Length',statSync(path).size);
          if(req.method==='HEAD')return res.end();const stream=createReadStream(path);stream.on('error',()=>res.destroy());stream.pipe(res);
        }catch{res.statusCode=503;res.end('Candidate unavailable');}
      });
    }
  }]:[])],
  server: { host:'127.0.0.1',port: 5173, strictPort: true, proxy: { '/api': {target:'http://127.0.0.1:8080',changeOrigin:true} } },
}));
