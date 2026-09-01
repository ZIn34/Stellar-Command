(async function(){
const G=window.SFXGEN, {B,tone,noise,verb,finish,wav}=G;
const made={};
function make(name,sec,build,peak){
  const b=B(sec); build(b); finish(b,peak||0.9);
  made[name]=wav(b);
}

/* --- interface --- */
make('click',0.09,b=>{
  noise(b,{dur:0.02,amp:.5,hp:1800,lp:9000,curve:3});
  tone(b,{f:1900,f2:1300,type:'sine',dur:0.06,amp:.35,atk:.001,curve:4});
});
make('select',0.19,b=>{
  tone(b,{f:660,f2:700,type:'sine',dur:.07,amp:.34,atk:.003,curve:3});
  tone(b,{f:990,f2:1050,type:'sine',dur:.12,t0:.055,amp:.32,atk:.004,curve:3});
  tone(b,{f:1980,type:'sine',dur:.08,t0:.055,amp:.09,atk:.004,curve:4});
  noise(b,{dur:.012,amp:.16,hp:3000,curve:3});
});
make('order',0.2,b=>{
  tone(b,{f:520,f2:880,type:'sine',dur:.13,amp:.36,atk:.004,curve:3});
  tone(b,{f:1040,f2:1760,type:'sine',dur:.1,amp:.12,atk:.004,curve:4});
  noise(b,{dur:.03,amp:.18,hp:2200,lp:8000,curve:3});
});
make('attackOrder',0.28,b=>{
  tone(b,{f:420,f2:180,type:'saw',dur:.18,amp:.3,atk:.003,curve:2});
  tone(b,{f:210,f2:90,type:'sine',dur:.22,amp:.28,atk:.004,curve:2});
  noise(b,{dur:.09,amp:.26,hp:900,lp:5200,lp2:1400,curve:2.4});
  tone(b,{f:1240,f2:820,type:'sine',dur:.07,amp:.1,atk:.002,curve:4});
});
make('deny',0.34,b=>{
  tone(b,{f:196,f2:150,type:'square',dur:.3,amp:.3,atk:.004,curve:1.4,am:22,amDepth:.85});
  tone(b,{f:98,f2:74,type:'saw',dur:.32,amp:.2,atk:.005,curve:1.6});
  noise(b,{dur:.05,amp:.12,hp:500,lp:2600,curve:2});
});

/* --- units and economy --- */
make('drill',0.24,b=>{
  tone(b,{f:170,f2:120,type:'saw',dur:.22,amp:.3,atk:.006,curve:1.6,am:58,amDepth:1});
  noise(b,{dur:.2,amp:.22,hp:700,lp:4200,lp2:1200,curve:2});
  tone(b,{f:2400,f2:1500,type:'sine',dur:.06,amp:.07,atk:.002,curve:4});
});
make('deposit',0.075,b=>{
  tone(b,{f:1760,f2:2100,type:'sine',dur:.055,amp:.4,atk:.001,curve:4});
  tone(b,{f:2640,type:'sine',dur:.035,amp:.14,atk:.001,curve:5});
});
make('trained',0.52,b=>{
  noise(b,{dur:.07,amp:.34,hp:200,lp:3000,lp2:700,curve:2.6});     // hatch clunk
  tone(b,{f:120,f2:70,type:'sine',dur:.12,amp:.3,atk:.002,curve:2});
  tone(b,{f:523,type:'tri',dur:.16,t0:.11,amp:.26,atk:.006,curve:3});
  tone(b,{f:784,type:'tri',dur:.28,t0:.2,amp:.26,atk:.006,curve:2.4});
  tone(b,{f:1568,type:'sine',dur:.2,t0:.2,amp:.07,atk:.006,curve:3});
  verb(b,.16,.5);
});

/* --- match --- */
make('deploy',1.5,b=>{
  noise(b,{dur:.75,amp:.3,hp:120,lp:300,lp2:7000,curve:.55,atk:.35});  // riser
  tone(b,{f:55,f2:110,type:'sine',dur:.8,amp:.34,atk:.4,curve:1});
  [330,440,554,659].forEach((f,i)=>{
    tone(b,{f,type:'tri',dur:.72,t0:.72+i*.02,amp:.2,atk:.012,curve:1.7});
    tone(b,{f:f*2,type:'sine',dur:.5,t0:.72+i*.02,amp:.05,atk:.012,curve:2});
  });
  noise(b,{dur:.16,t0:.7,amp:.2,hp:2000,lp:11000,curve:3});
  verb(b,.22,1.1);
});
make('victory',2.6,b=>{
  const notes=[523.25,659.25,783.99,1046.5];
  notes.forEach((f,i)=>{
    const t=i*.16;
    tone(b,{f,type:'tri',dur:2.2-t,t0:t,amp:.22,atk:.02,curve:1.5});
    tone(b,{f:f*2,type:'sine',dur:1.4-t*.5,t0:t,amp:.06,atk:.02,curve:2});
  });
  tone(b,{f:130.8,type:'sine',dur:2.3,amp:.22,atk:.03,curve:1.3});
  tone(b,{f:196,type:'sine',dur:2.3,t0:.1,amp:.14,atk:.04,curve:1.3});
  noise(b,{dur:.5,t0:.02,amp:.1,hp:4000,lp:14000,curve:2.5});
  verb(b,.3,1.6);
});
make('defeat',2.6,b=>{
  const notes=[392,311.1,261.6,196];
  notes.forEach((f,i)=>{
    const t=i*.24;
    tone(b,{f,type:'tri',dur:1.9-t*.4,t0:t,amp:.2,atk:.03,curve:1.4});
    tone(b,{f:f/2,type:'sine',dur:1.9-t*.4,t0:t,amp:.12,atk:.04,curve:1.3});
  });
  tone(b,{f:65.4,f2:49,type:'sine',dur:2.4,amp:.3,atk:.06,curve:1.1});
  noise(b,{dur:1.6,amp:.09,hp:60,lp:900,lp2:180,curve:1.6});
  verb(b,.26,1.8);
});

const names=Object.keys(made), out=[];
for(const n of names){
  const r=await fetch('/_save?name='+n+'.wav',{method:'POST',body:made[n]});
  out.push(n+':'+(await r.text()).replace('saved ',''));
}
window.__genResult=out.join(' ');
})();
