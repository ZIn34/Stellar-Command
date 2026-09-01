/* offline SFX designer: builds buffers sample-by-sample, then saves WAVs */
(function(){
const SR=44100;
const B=sec=>({d:new Float32Array(Math.max(1,Math.round(sec*SR))),sr:SR});
const clampv=(v,a,b)=>v<a?a:v>b?b:v;
function env(i,n,atk,rel,curve){
  const t=i/n;
  let a=1;
  const at=atk||0.004, rl=rel===undefined?0.5:rel;
  if(t<at) a=t/at;
  else { const x=(t-at)/(1-at); a=Math.pow(1-x,curve||2); }
  return a;
}
function tone(b,o){
  const n=Math.round(o.dur*SR), s=Math.round((o.t0||0)*SR);
  const type=o.type||'sine';
  let ph=0;
  for(let i=0;i<n;i++){
    const k=s+i; if(k>=b.d.length) break;
    const t=i/n;
    const f=o.f2!==undefined?o.f*Math.pow(o.f2/o.f,t):o.f;
    ph+=2*Math.PI*f/SR;
    let v;
    if(type==='sine') v=Math.sin(ph);
    else if(type==='tri') v=Math.asin(Math.sin(ph))*(2/Math.PI);
    else if(type==='saw') v=((ph/(2*Math.PI))%1)*2-1;
    else v=Math.sin(ph)>=0?1:-1;
    let a=env(i,n,o.atk,o.rel,o.curve)*(o.amp||.3);
    if(o.am) a*=(1-o.amDepth/2)+Math.sin(2*Math.PI*o.am*i/SR)*(o.amDepth/2);
    b.d[k]+=v*a;
  }
}
function noise(b,o){
  const n=Math.round(o.dur*SR), s=Math.round((o.t0||0)*SR);
  let lpz=0, hpz=0, hpy=0;
  for(let i=0;i<n;i++){
    const k=s+i; if(k>=b.d.length) break;
    const t=i/n;
    let v=Math.random()*2-1;
    const lp=o.lp!==undefined?(o.lp2!==undefined?o.lp*Math.pow(o.lp2/o.lp,t):o.lp):null;
    if(lp){ const a=1-Math.exp(-2*Math.PI*lp/SR); lpz+=a*(v-lpz); v=lpz; }
    if(o.hp){ const a=1-Math.exp(-2*Math.PI*o.hp/SR); hpz+=a*(v-hpz); v=v-hpz; }
    b.d[k]+=v*env(i,n,o.atk,o.rel,o.curve)*(o.amp||.3);
  }
}
function verb(b,mix,time){
  const taps=[0.017,0.029,0.041,0.053,0.071].map(x=>Math.round(x*SR));
  const out=new Float32Array(b.d.length);
  for(let t=0;t<taps.length;t++){
    const dl=taps[t], g=Math.pow(0.62,t+1)*mix;
    for(let i=dl;i<b.d.length;i++){
      const decay=Math.exp(-3*(i/SR)/(time||1));
      out[i]+=b.d[i-dl]*g*decay;
    }
  }
  for(let i=0;i<b.d.length;i++) b.d[i]+=out[i];
}
function finish(b,peakTo){
  const n=b.d.length;
  let p=0; for(let i=0;i<n;i++) p=Math.max(p,Math.abs(b.d[i]));
  const g=p>0?(peakTo||0.9)/p:1;
  const fi=Math.round(SR*0.002), fo=Math.round(SR*0.012);
  for(let i=0;i<n;i++){
    let a=g;
    if(i<fi) a*=i/fi;
    if(n-i<fo) a*=(n-i)/fo;
    b.d[i]=clampv(b.d[i]*a,-1,1);
  }
  return b;
}
function wav(b){
  const n=b.d.length, bytes=44+n*2, w=new DataView(new ArrayBuffer(bytes));
  const st=(x,s)=>{ for(let i=0;i<s.length;i++) w.setUint8(x+i,s.charCodeAt(i)); };
  st(0,'RIFF'); w.setUint32(4,bytes-8,true); st(8,'WAVE'); st(12,'fmt ');
  w.setUint32(16,16,true); w.setUint16(20,1,true); w.setUint16(22,1,true);
  w.setUint32(24,SR,true); w.setUint32(28,SR*2,true); w.setUint16(32,2,true); w.setUint16(34,16,true);
  st(36,'data'); w.setUint32(40,n*2,true);
  for(let i=0;i<n;i++){ const v=b.d[i]; w.setInt16(44+i*2,v<0?v*32768:v*32767,true); }
  return w.buffer;
}
window.SFXGEN={B,tone,noise,verb,finish,wav,SR};
})();
'gen ready'
