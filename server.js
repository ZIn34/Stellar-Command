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
  /* ---- store ----
     The shop calls these from the public GitHub Pages site, so they allow any
     origin. Payments are deliberately OFF: nothing here creates a charge yet.
     Turning it on means adding Stripe Checkout session creation to /api/checkout,
     a signed /api/webhook that records purchases, and a database to hold them -
     ownership must live here, never in the browser. */
  if(url.indexOf('/api/')===0){
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    if(req.method==='OPTIONS'){ res.writeHead(204); res.end(); return; }
    const json=(code,obj)=>{ res.writeHead(code,{'Content-Type':'application/json'}); res.end(JSON.stringify(obj)); };
    if(url==='/api/store'){ json(200,{enabled:false, owned:[]}); return; }
    if(url==='/api/checkout'){ json(503,{error:'Payments are not set up yet.'}); return; }
    json(404,{error:'Not found'}); return;
  }
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
/* Eight. The game seats that many and every per-player table in it is sized
   from the same number; this was the one place still saying four, which is
   why an eight-commander room came back as a duel. */
const MAXP=8;
function newCode(){
  let code;
  do{ code=String(Math.floor(1000+Math.random()*9000)); }while(rooms.has(code));
  return code;
}
/* A client picks its own mode and faction, and those strings are handed
   straight back out to every other client. Only ever store one we know. */
/* A mode this does not recognise is quietly answered as a duel, so a mode
   missing from here is not an error anybody sees - the room simply comes
   back smaller than it was asked for. Keep it in step with MODES. */
const MODE_OK={duel:1,team:1,ffa:1,ffa5:1,ffa6:1,ffa7:1,ffa8:1,team4:1},
      FAC_OK={concord:1,legion:1,pact:1};
function pick(tbl,v,dflt){
  return (typeof v==='string'&&Object.prototype.hasOwnProperty.call(tbl,v))?v:dflt;
}
function okMode(m){ return pick(MODE_OK,m,'duel'); }
function okFac(f){ return pick(FAC_OK,f,'concord'); }
/* A duel seats two, not four. The room used to list and admit against MAXP
   whatever the mode, so a 1v1 advertised '1 / 4 waiting' and could be
   overfilled in the round trip before the host's client called begin. */
const MODE_SEATS={duel:2,team:4,ffa:4,ffa5:5,ffa6:6,ffa7:7,ffa8:8,team4:8};
function capOf(room){ return MODE_SEATS[room&&room.mode]||MAXP; }
function liveCount(room){ return room.players.filter(Boolean).length; }
function openRoom(c,quick,mode,pub){
  const code=newCode();
  const room={code,players:[c],quick:!!quick,born:Date.now(),seen:Date.now(),
              started:false,done:false,
              toks:[c.id],                    // which seat each player may reclaim
              /* Alternating, which splits 2v2 and 4v4 evenly; the host can
                 rearrange them. A free-for-all overrides it at begin. */
              teams:[0,1,0,1,0,1,0,1],
              pub:!!pub,                      // listed in the browser, or code-only
              mode:okMode(mode)};
  rooms.set(code,room); c.room=room;
  send(c,{t:'hosted',code,quick:!!quick,tok:c.id});
  roster(room);
  return room;
}
function hostOf(room){ return room.players[0]; }
function roster(room){
  room.seen=Date.now();
  const cap=capOf(room);
  room.players.forEach((c,i)=>{
    if(!c) return;
    send(c,{t:'roster',code:room.code,n:liveCount(room),max:cap,slot:i,
            host:i===0,mode:room.mode,pub:!!room.pub,tok:c.id,
            teams:room.teams.slice(0,MAXP),
            facs:room.players.slice(0,MAXP).map(p=>(p&&p.fac)||null)});
  });
}
function addPlayer(room,c){
  if(room.started||room.done||room.players.length>=capOf(room)) return false;
  room.players.push(c); room.toks[room.players.length-1]=c.id;
  c.room=room; roster(room); return true;
}
/* The host decides when to go: everyone in gets a slot, the rest become bots. */
/* Only a scale we know about is ever handed back out. */
const SCALE_OK={standard:1,grand:1,blitz:1};
function okScale(v){ return pick(SCALE_OK,v,'standard'); }
function begin(room,mode,grand,seed,terrain,scale){
  room.started=true;
  const facs=new Array(MAXP).fill('concord');
  room.players.forEach((pl,i)=>{ if(pl&&pl.fac&&i<MAXP) facs[i]=okFac(pl.fac); });
  /* Every free-for-all gives each seat its own side, whatever its size;
     anything else keeps the pairing the host arranged. */
  const teams=/^ffa/.test(mode)
    ? Array.from({length:MAXP},(_,i)=>i)
    : room.teams.slice(0,MAXP);
  const sc=okScale(scale!==undefined?scale:(grand?'grand':'standard'));
  room.cfg={mode:mode,grand:!!grand,scale:sc,seed:seed,terrain:terrain,
            count:room.players.length,facs:facs,teams:teams};
  room.players.forEach((c,i)=>{
    if(!c) return;
    room.toks[i]=c.id;
    send(c,{t:'start',role:i===0?'host':'guest',code:room.code,
            slot:i,count:room.players.length,mode:mode,grand:!!grand,scale:sc,
            seed:seed,terrain:terrain,facs:facs,teams:teams,tok:c.id});
  });
}
function handle(c,text){
  let m; try{ m=JSON.parse(text); }catch(e){ return; }
  if(m.t==='host'){ if(c.room) return; c.fac=okFac(m.fac); openRoom(c,false,m.mode,m.pub); return; }
  if(m.t==='quick'){
    if(c.room) return;
    for(const room of rooms.values()){
      if(room.quick&&!room.started&&!room.done&&
         room.players.length<capOf(room)&&room.players.indexOf(c)<0){
        if(addPlayer(room,c)) return;
      }
    }
    c.fac=okFac(m.fac);
    openRoom(c,true,m.mode,true);   // quick play is public by nature
    send(c,{t:'searching'});
    return;
  }
  if(m.t==='join'){
    if(c.room) return;
    const room=rooms.get(String(m.code||'').trim());
    if(!room){ send(c,{t:'error',msg:'No game with that code'}); return; }
    if(room.done){ send(c,{t:'error',msg:'That game is already over'}); return; }
    if(room.started){                          // rejoin a seat that opened up
      /* Handing out the first empty seat put a returning player in someone
         else's army whenever two dropped at once. Each seat remembers the
         token of whoever held it, so a reconnect reclaims its own. */
      let seat=-1;
      if(m.tok) for(let i=0;i<room.players.length;i++)
        if(!room.players[i]&&room.toks[i]===m.tok){ seat=i; break; }
      if(seat<0) seat=room.players.indexOf(null);
      if(seat<0){ send(c,{t:'error',msg:'That game is full'}); return; }
      room.players[seat]=c; room.toks[seat]=c.id;
      c.room=room; c.fac=okFac(m.fac||c.fac); room.seen=Date.now();
      const g=room.cfg||{};
      send(c,{t:'start',role:'guest',code:room.code,slot:seat,count:g.count||room.players.length,
              mode:g.mode,grand:!!g.grand,scale:g.scale,seed:g.seed,terrain:g.terrain,
              facs:g.facs,teams:g.teams,tok:c.id,rejoin:true});
      for(const o of room.players) if(o&&o!==c) send(o,{t:'peerback',slot:seat});
      return;
    }
    if(room.done){ send(c,{t:'error',msg:'That game is already over'}); return; }
    if(room.players.length>=capOf(room)){ send(c,{t:'error',msg:'That game is already full'}); return; }
    if(room.players.indexOf(c)>=0){ send(c,{t:'error',msg:'That is your own code'}); return; }
    c.fac=okFac(m.fac);
    addPlayer(room,c);
    return;
  }
  if(m.t==='begin'){
    const room=c.room;
    if(!room||room.started||hostOf(room)!==c) return;
    if(m.mode!==undefined) room.mode=okMode(m.mode);
    begin(room,room.mode,m.grand,m.seed,m.terrain,m.scale);
    return;
  }
  if(m.t==='list'){
    // open rooms only: started or full ones cannot be joined
    const out=[];
    for(const room of rooms.values()){
      if(room.started||room.done) continue;
      if(!room.pub) continue;                 // a code-only room stays unlisted
      const cap=capOf(room);
      const n=room.players.filter(Boolean).length;
      if(!n||n>=cap) continue;
      if(room.players.indexOf(c)>=0) continue;
      out.push({code:room.code,n:n,max:cap,mode:room.mode||'duel',quick:!!room.quick,
                age:Math.round((Date.now()-room.born)/1000)});
    }
    out.sort((a,b)=>b.n-a.n||a.age-b.age);
    send(c,{t:'rooms',rooms:out.slice(0,40)});
    return;
  }
  if(m.t==='fac'){
    /* Anyone may change their own doctrine while the room is still open, so
       you pick your legion with your team in front of you. */
    const room=c.room;
    if(room&&!room.started){ c.fac=okFac(m.fac); roster(room); }
    return;
  }
  if(m.t==='seat'){
    // only the host arranges the sides, and only before the match begins
    const room=c.room;
    if(!room||room.started||hostOf(room)!==c) return;
    const i=m.slot|0;
    if(i<0||i>3) return;
    room.teams[i]=(m.team|0)?1:0;
    roster(room);
    return;
  }
  if(m.t==='finished'){
    /* A finished match used to stay joinable forever: room.started kept the
       sweep away and nothing marked it over, so a reconnect was handed a
       dead world. The host tells us, and the room stops taking players. */
    const room=c.room;
    if(room&&hostOf(room)===c){ room.done=true; room.seen=Date.now(); }
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
  for(const [code,room] of rooms){
    const idle=now-(room.seen||room.born);
    /* This used to tell the host alone and null every other player's room out
       from under them, so each guest sat on a spinner for a room that no
       longer existed. Everybody hears about it, and the clock runs from the
       last sign of life rather than from when the room was opened. */
    if(!room.started&&idle>10*60*1000){
      for(const o of room.players) if(o){ o.room=null; send(o,{t:'error',msg:'Lobby timed out'}); }
      rooms.delete(code); continue;
    }
    if(room.done&&idle>5*60*1000){            // a finished match, long since over
      for(const o of room.players) if(o) o.room=null;
      rooms.delete(code);
    }
  }
},60*1000);

server.listen(PORT,()=>{
  console.log('Stellar Command server on http://localhost:'+PORT);
  console.log('Same network? Others join at http://<your-ip>:'+PORT);
});
