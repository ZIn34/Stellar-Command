/* Stellar Command - lobby + relay server.
   Zero dependencies: serves the game and relays messages between two players.
   Run:  node server.js  [port]
   Then open http://localhost:8080 on both machines (or over your LAN / a tunnel). */
'use strict';
const http=require('http'), fs=require('fs'), path=require('path'), crypto=require('crypto');

const PORT=parseInt(process.argv[2]||process.env.PORT||'8080',10);
const GAME=path.join(__dirname,'stellar-command.html');

/* ---------------- static file serving ---------------- */
const server=http.createServer((req,res)=>{
  const url=(req.url||'/').split('?')[0];
  if(process.env.SC_LOG) console.log(req.method,req.url);
  if(url==='/'||url==='/index.html'||url==='/stellar-command.html'){
    fs.readFile(GAME,(err,buf)=>{
      if(err){ res.writeHead(404); res.end('stellar-command.html not found next to server.js'); return; }
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(buf);
    });
    return;
  }
  if(url==='/health'){ res.writeHead(200); res.end('ok'); return; }
  if(url==='/_save'&&req.method==='POST'){          // local asset authoring helper
    const q=(req.url.split('?')[1]||'');
    const nm=decodeURIComponent((/name=([^&]+)/.exec(q)||[])[1]||'');
    if(!/^[A-Za-z0-9_-]+\.(wav|json)$/.test(nm)){ res.writeHead(400); res.end('bad name'); return; }
    const chunks=[];
    req.on('data',d=>chunks.push(d));
    req.on('end',()=>{
      try{ fs.writeFileSync(path.join(__dirname,nm),Buffer.concat(chunks));
           res.writeHead(200); res.end('saved '+nm); }
      catch(e){ res.writeHead(500); res.end(String(e)); }
    });
    return;
  }
  // serve the assets that live next to the game (theme music, icons, ...)
  const name=path.basename(decodeURIComponent(url));
  const TYPES={'.mp4':'video/mp4','.m4a':'audio/mp4','.mp3':'audio/mpeg','.ogg':'audio/ogg',
    '.wav':'audio/wav','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
    '.webp':'image/webp','.ico':'image/x-icon','.json':'application/json',
    '.js':'text/javascript'};
  const ext=path.extname(name).toLowerCase();
  if(name&&TYPES[ext]){
    const file=path.join(__dirname,name);
    fs.stat(file,(err,st)=>{
      if(err||!st.isFile()){ res.writeHead(404); res.end('not found'); return; }
      const range=req.headers.range;                       // audio seeking wants ranges
      if(range){
        const m=/bytes=(\d*)-(\d*)/.exec(range)||[];
        const start=m[1]?parseInt(m[1],10):0;
        const end=m[2]?parseInt(m[2],10):st.size-1;
        if(start>=st.size){ res.writeHead(416,{'Content-Range':'bytes */'+st.size}); res.end(); return; }
        res.writeHead(206,{'Content-Type':TYPES[ext],'Accept-Ranges':'bytes',
          'Content-Range':'bytes '+start+'-'+end+'/'+st.size,'Content-Length':end-start+1});
        fs.createReadStream(file,{start,end}).pipe(res);
      } else {
        res.writeHead(200,{'Content-Type':TYPES[ext],'Accept-Ranges':'bytes','Content-Length':st.size});
        fs.createReadStream(file).pipe(res);
      }
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

/* ---------------- minimal WebSocket (RFC 6455) ---------------- */
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients=new Set();

server.on('upgrade',(req,socket)=>{
  const key=req.headers['sec-websocket-key'];
  if(!key){ socket.destroy(); return; }
  const accept=crypto.createHash('sha1').update(key+GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n'+
    'Upgrade: websocket\r\nConnection: Upgrade\r\n'+
    'Sec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.setNoDelay(true);
  const c={socket,buf:Buffer.alloc(0),frag:[],fragOp:0,room:null,alive:true,id:crypto.randomBytes(4).toString('hex')};
  clients.add(c);
  socket.on('data',d=>{ c.buf=Buffer.concat([c.buf,d]); drain(c); });
  socket.on('error',()=>dropClient(c));
  socket.on('close',()=>dropClient(c));
});

function drain(c){
  for(;;){
    const b=c.buf;
    if(b.length<2) return;
    const fin=(b[0]&0x80)!==0, op=b[0]&0x0f, masked=(b[1]&0x80)!==0;
    let len=b[1]&0x7f, off=2;
    if(len===126){ if(b.length<4) return; len=b.readUInt16BE(2); off=4; }
    else if(len===127){ if(b.length<10) return; const hi=b.readUInt32BE(2); if(hi!==0){ dropClient(c); return; }
      len=b.readUInt32BE(6); off=10; }
    if(len>4*1024*1024){ dropClient(c); return; }
    const need=off+(masked?4:0)+len;
    if(b.length<need) return;
    let mask=null;
    if(masked){ mask=b.slice(off,off+4); off+=4; }
    const payload=Buffer.from(b.slice(off,off+len));
    if(mask) for(let i=0;i<payload.length;i++) payload[i]^=mask[i&3];
    c.buf=b.slice(need);
    if(op===0x8){ dropClient(c); return; }
    if(op===0x9){ sendFrame(c,0xA,payload); continue; }
    if(op===0xA) continue;
    if(op===0x0){ c.frag.push(payload); }
    else { c.frag=[payload]; c.fragOp=op; }
    if(fin){
      const full=Buffer.concat(c.frag); c.frag=[];
      if(c.fragOp===0x1){ handle(c,full.toString('utf8')); }
    }
  }
}
function sendFrame(c,op,payload){
  if(!c.alive) return;
  const len=payload.length;
  let head;
  if(len<126){ head=Buffer.alloc(2); head[1]=len; }
  else if(len<65536){ head=Buffer.alloc(4); head[1]=126; head.writeUInt16BE(len,2); }
  else { head=Buffer.alloc(10); head[1]=127; head.writeUInt32BE(0,2); head.writeUInt32BE(len,6); }
  head[0]=0x80|op;
  try{ c.socket.write(Buffer.concat([head,payload])); }catch(e){ dropClient(c); }
}
function send(c,obj){ sendFrame(c,0x1,Buffer.from(JSON.stringify(obj),'utf8')); }

/* ---------------- lobby ---------------- */
const rooms=new Map();          // code -> {code, players[], quick, born, started}
const MAXP=4;
function newCode(){
  let code;
  do{ code=String(Math.floor(1000+Math.random()*9000)); }while(rooms.has(code));
  return code;
}
function openRoom(c,quick,mode){
  const code=newCode();
  const room={code,players:[c],quick:!!quick,born:Date.now(),started:false,
              mode:(typeof mode==='string'?mode:'duel')};
  rooms.set(code,room); c.room=room;
  send(c,{t:'hosted',code,quick:!!quick});
  roster(room);
  return room;
}
function hostOf(room){ return room.players[0]; }
function roster(room){
  room.players.forEach((c,i)=>{
    send(c,{t:'roster',code:room.code,n:room.players.length,max:MAXP,slot:i,
            host:i===0,mode:room.mode});
  });
}
function addPlayer(room,c){
  if(room.started||room.players.length>=MAXP) return false;
  room.players.push(c); c.room=room; roster(room); return true;
}
/* The host decides when to go: everyone in gets a slot, the rest become bots. */
function begin(room,mode,grand,seed,terrain){
  room.started=true;
  room.cfg={mode:mode,grand:!!grand,seed:seed,terrain:terrain,count:room.players.length};
  room.players.forEach((c,i)=>{
    send(c,{t:'start',role:i===0?'host':'guest',code:room.code,
            slot:i,count:room.players.length,mode:mode,grand:!!grand,seed:seed,terrain:terrain});
  });
}
function handle(c,text){
  let m; try{ m=JSON.parse(text); }catch(e){ return; }
  if(m.t==='host'){ if(c.room) return; openRoom(c,false,m.mode); return; }
  if(m.t==='quick'){
    if(c.room) return;
    for(const room of rooms.values()){
      if(room.quick&&!room.started&&room.players.length<MAXP&&room.players.indexOf(c)<0){
        if(addPlayer(room,c)) return;
      }
    }
    openRoom(c,true,m.mode);
    send(c,{t:'searching'});
    return;
  }
  if(m.t==='join'){
    if(c.room) return;
    const room=rooms.get(String(m.code||'').trim());
    if(!room){ send(c,{t:'error',msg:'No game with that code'}); return; }
    if(room.started){                          // rejoin a seat that opened up
      const seat=room.players.indexOf(null);
      if(seat<0){ send(c,{t:'error',msg:'That game is full'}); return; }
      room.players[seat]=c; c.room=room;
      const g=room.cfg||{};
      send(c,{t:'start',role:'guest',code:room.code,slot:seat,count:g.count||room.players.length,
              mode:g.mode,grand:!!g.grand,seed:g.seed,terrain:g.terrain,rejoin:true});
      for(const o of room.players) if(o&&o!==c) send(o,{t:'peerback',slot:seat});
      return;
    }
    if(room.players.length>=MAXP){ send(c,{t:'error',msg:'That game is already full'}); return; }
    if(room.players.indexOf(c)>=0){ send(c,{t:'error',msg:'That is your own code'}); return; }
    addPlayer(room,c);
    return;
  }
  if(m.t==='begin'){
    const room=c.room;
    if(!room||room.started||hostOf(room)!==c) return;
    room.mode=m.mode||room.mode;
    begin(room,room.mode,m.grand,m.seed,m.terrain);
    return;
  }
  if(m.t==='cancel'){ leaveRoom(c); return; }
  if(m.t==='relay'){
    const room=c.room; if(!room) return;
    const from=room.players.indexOf(c); if(from<0) return;
    const to=(typeof m.to==='number')?[room.players[m.to]]:room.players;
    if(!to) return;
    const buf=Buffer.from(JSON.stringify({t:'relay',d:m.d,from}),'utf8');
    for(const o of to) if(o&&o!==c) sendFrame(o,0x1,buf);
    return;
  }
}
function leaveRoom(c){
  const room=c.room; if(!room) return;
  c.room=null;
  const i=room.players.indexOf(c);
  if(i<0) return;
  // The host owns the simulation, so its exit ends the room for everyone.
  if(i===0){
    rooms.delete(room.code);
    for(const o of room.players) if(o&&o!==c){ o.room=null; send(o,{t:'peerleft'}); }
    return;
  }
  if(room.started){
    room.players[i]=null;                     // seat held open for a reconnect
    for(const o of room.players) if(o) send(o,{t:'peergone',slot:i});
    return;
  }
  room.players.splice(i,1);
  roster(room);
}
function dropClient(c){
  if(!c.alive) return;
  c.alive=false; clients.delete(c);
  leaveRoom(c);
  try{ c.socket.destroy(); }catch(e){}
}
setInterval(()=>{                            // sweep abandoned lobbies
  const now=Date.now();
  for(const [code,room] of rooms) if(!room.started&&now-room.born>10*60*1000){
    const h=hostOf(room);
    if(h) send(h,{t:'error',msg:'Lobby timed out'});
    for(const o of room.players) if(o) o.room=null;
    rooms.delete(code);
  }
},60*1000);

server.listen(PORT,()=>{
  console.log('Stellar Command server on http://localhost:'+PORT);
  console.log('Same network? Others join at http://<your-ip>:'+PORT);
});
