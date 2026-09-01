window.mkSfx=async function(src,out,maxMs,peakTo){
  const AC=window.AudioContext||window.webkitAudioContext;
  const ac=new AC();
  const ab=await ac.decodeAudioData((await (await fetch(src)).arrayBuffer()).slice(0));
  const n=ab.length, ch=ab.numberOfChannels, sr=ab.sampleRate;
  const mono=new Float32Array(n);
  for(let c=0;c<ch;c++){ const d=ab.getChannelData(c); for(let i=0;i<n;i++) mono[i]+=d[i]/ch; }
  let peak=0; for(let i=0;i<n;i++) peak=Math.max(peak,Math.abs(mono[i]));
  let on=0; for(let i=0;i<n;i++){ if(Math.abs(mono[i])>peak*0.04){ on=i; break; } }
  on=Math.max(0,on-Math.round(sr*0.004));
  const len=Math.min(Math.round(sr*maxMs/1000),n-on);
  const o=new Float32Array(len);
  for(let i=0;i<len;i++) o[i]=mono[on+i];
  let p=0; for(let i=0;i<len;i++) p=Math.max(p,Math.abs(o[i]));
  const gain=p>0?(peakTo||0.92)/p:1;
  const fi=Math.round(sr*0.002), fo=Math.round(len*0.35);
  for(let i=0;i<len;i++){ let g=gain; if(i<fi) g*=i/fi; const t=len-i; if(t<fo) g*=t/fo; o[i]*=g; }
  const bytes=44+len*2, w=new DataView(new ArrayBuffer(bytes));
  const st=(x,s2)=>{ for(let i=0;i<s2.length;i++) w.setUint8(x+i,s2.charCodeAt(i)); };
  st(0,'RIFF'); w.setUint32(4,bytes-8,true); st(8,'WAVE'); st(12,'fmt ');
  w.setUint32(16,16,true); w.setUint16(20,1,true); w.setUint16(22,1,true);
  w.setUint32(24,sr,true); w.setUint32(28,sr*2,true); w.setUint16(32,2,true); w.setUint16(34,16,true);
  st(36,'data'); w.setUint32(40,len*2,true);
  for(let i=0;i<len;i++){ const v=Math.max(-1,Math.min(1,o[i])); w.setInt16(44+i*2,v<0?v*32768:v*32767,true); }
  const res=await fetch('/_save?name='+out,{method:'POST',body:w.buffer});
  return {out, srcDur:Math.round(ab.duration*100)/100, onsetMs:Math.round(on/sr*1000),
    clipMs:Math.round(len/sr*1000), origPeak:Math.round(peak*100)/100,
    gain:Math.round(gain*100)/100, saved:await res.text()};
};
'mkSfx ready'
