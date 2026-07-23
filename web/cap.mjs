import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
await p.goto("http://localhost:5173/?course=four-oaks-dracut",{waitUntil:"load"});
await p.evaluate((cap)=>new Promise(r=>{const m=window.__golf?.map;let d=false;const f=()=>{if(!d){d=true;setTimeout(r,2500);}};if(m)m.once("idle",f);setTimeout(f,14000);}),14000);
async function shot(path){const u=await p.evaluate(()=>document.querySelector("canvas")?.toDataURL("image/png")??"");if(!u.startsWith("data:image/png;base64,"))throw new Error("blank "+path);writeFileSync(path,Buffer.from(u.split(",")[1],"base64"));console.log("wrote",path);}
// Low camera behind the ball, looking down-line toward the far ridge. Fire the ball.
const info = await p.evaluate(()=>{
  const {map,ballLayer}=window.__golf;
  const t=ballLayer.ball.lngLat;
  // aim bearing tee->pin
  const pin=[-71.2965236,42.6866087];
  const brg=(()=>{const a=t,b=pin;const la1=a[1]*Math.PI/180,la2=b[1]*Math.PI/180,dL=(b[0]-a[0])*Math.PI/180;const y=Math.sin(dL)*Math.cos(la2);const x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dL);return (Math.atan2(y,x)*180/Math.PI+360)%360;})();
  map.jumpTo({center:t,zoom:16.5,pitch:82,bearing:brg});
  ballLayer.ball.reset();
  ballLayer.ball.hit(brg, 46, 20); // bearing, speed m/s, launch deg
  return {brg};
});
console.log("aim",JSON.stringify(info));
// capture arc frames
for(let i=0;i<6;i++){ await p.waitForTimeout(450); await shot(`shots/occl-${i}.png`); const st=await p.evaluate(()=>{const bl=window.__golf.ballLayer.ball;return {s:bl.state,h:+bl.heightAboveGround.toFixed(1)};}); console.log("frame",i,JSON.stringify(st)); }
console.log("ERRORS",JSON.stringify(errs));
await b.close();
