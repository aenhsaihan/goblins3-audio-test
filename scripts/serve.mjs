import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../docs');
const prefix='/goblins3-audio-test/';
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.zip':'application/zip','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:4174');
  if(url.pathname==='/'){res.writeHead(302,{location:prefix}).end();return;}
  if(!url.pathname.startsWith(prefix)){res.writeHead(404).end('Not found');return;}
  let file=path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.length))||'index.html');
  if(!file.startsWith(root+'/'))throw Error('Invalid path');
  if((await stat(file)).isDirectory())file=path.join(file,'index.html');
  const data=await readFile(file),headers={'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store','accept-ranges':'bytes'};
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if(range){const from=+range[1],to=Math.min(range[2]?+range[2]:data.length-1,data.length-1);if(from>to){res.writeHead(416).end();return;}res.writeHead(206,{...headers,'content-range':`bytes ${from}-${to}/${data.length}`,'content-length':to-from+1}).end(data.subarray(from,to+1));}
  else res.writeHead(200,{...headers,'content-length':data.length}).end(data);
 }catch{res.writeHead(404).end('Not found');}
}).listen(4174,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4174/goblins3-audio-test/'));
