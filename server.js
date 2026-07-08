#!/usr/bin/env node
// Servidor estático mínimo para ver el dashboard en local: node server.js -> http://localhost:4500
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 4500;
const MIME = {'.html':'text/html','.json':'application/json','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(__dirname, p);
  fs.readFile(file,(err,data)=>{
    if (err){ res.writeHead(404); return res.end('404'); }
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});
    res.end(data);
  });
}).listen(PORT, ()=>console.log(`Dashboard en http://localhost:${PORT}`));
