/** Capture the real plugin in a minimal host. Dev-only: requires Playwright and ffmpeg. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "assets", "readme");
const browserPath = process.env.DSH_README_BROWSER || [
 "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
 "/usr/bin/chromium", "/usr/bin/google-chrome",
].find(p => fs.existsSync(p));
const escapeXml = s => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]);
const ffmpeg = (...args) => {
 const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {encoding:"utf8"});
 if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
};
async function exportSvg(page, mode, height) {
 // Static, editable SVG fallback derived from the actual painted contour and text.
 const samples = [];
 for (const frame of page.frames().slice(1)) samples.push(await frame.evaluate(() => {
  const tail=document.querySelector(".runningIcon"), svg=tail.querySelector("svg.dsh-status-rotator-tail-morph"), p=svg.querySelector("path");
  const text=document.querySelector(".dsh-status-rotator-text");
  return {d:getComputedStyle(p).d.replace(/^path\(["']|["']\)$/g,""),viewBox:svg.getAttribute("viewBox"),color:getComputedStyle(tail).color,text:text?.textContent||"Thinking outside the box…"};
 }));
 const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height*4/3}" viewBox="0 0 1200 ${height*4/3}" role="img" aria-labelledby="title desc">`,
  `<title id="title">${mode==="hero"?"Status text, typewriter and day/night gradient":"Three whale-tail motions"}</title>`,
  `<desc id="desc">Static fallback of the actual plugin rendered in a minimal DSH host. ${mode==="hero"?"Custom phrases beside a whale tail in light and dark themes.":"Original wag, sway and twist at the same fixed speed."}</desc>`,
  `<rect width="1200" height="${height*4/3}" fill="#f5f7fb"/>`,
  `<g transform="scale(1.333333)" font-family="system-ui,Segoe UI,sans-serif">`];
 samples.forEach((sample,i)=>{
  const variant=mode==="variants", x=variant?24+i*288:24, y=variant?24:24+i*120, w=variant?276:852;
  const size=variant?180:54, tx=variant?x+48:x+130, ty=variant?y+14:y+27;
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${variant?259:108}" rx="14" fill="${!variant&&i===1?"#171a23":"#ffffff"}"/>`);
  parts.push(`<svg x="${tx}" y="${ty}" width="${size}" height="${size}" viewBox="${sample.viewBox}"><path d="${escapeXml(sample.d)}" fill="${sample.color}"/></svg>`);
  if(variant)parts.push(`<text x="${x+w/2}" y="${y+234}" text-anchor="middle" fill="#24314a" font-size="26" font-weight="600">${["Original wag","Sway","Twist"][i]}</text>`);
  else parts.push(`<text x="${x+24}" y="${y+60}" fill="${i===1?"#8f9ab2":"#7a869d"}" font-size="18" font-weight="600">${i===1?"DARK":"LIGHT"}</text><text x="${tx+72}" y="${y+65}" fill="${sample.color}" font-size="30" font-weight="500">${escapeXml(sample.text)}</text>`);
 });
 parts.push("</g></svg>");
 fs.writeFileSync(path.join(output,mode==="hero"?"status-preview.svg":"whale-motions.svg"),parts.join("\n")+"\n");
}
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const temp = fs.mkdtempSync(path.join(os.tmpdir(),"dsh-readme-"));
 const browser = await chromium.launch({executablePath:browserPath,headless:true});
 try {
  for (const [mode,height,duration,name] of [["hero",276,6,"status-preview"],["variants",310,4,"whale-motions"]]) {
   const page=await browser.newPage({viewport:{width:900,height},deviceScaleFactor:1});
   const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.clock.install({time:new Date("2026-09-30T00:00:00Z")});
   await page.goto(pathToFileURL(path.join(__dirname,"readme-demo.html")).href+"?view="+mode);
   for(const frame of page.frames().slice(1))await frame.waitForSelector("[data-dsh-tail-animation]");
   await page.clock.pauseAt(new Date("2026-09-30T00:00:03Z"));
   // Start in a readable hold. Two phrases alternate every 3 seconds; a 6-second loop.
   await page.clock.runFor(2500);
   const frames=page.frames().slice(1);
   if(mode==="hero")for(const frame of frames){
    const text=await frame.locator(".dsh-status-rotator-text").textContent();
    if(!["Thinking outside the box…","Connecting the dots…"].includes(text))throw new Error("Preview must start with a fully typed phrase: "+text);
   }
   for(let n=0;n<duration*25;n++){
    if(n)await page.clock.runFor(40);
    for(const frame of frames)await frame.evaluate(t=>{
     for(const a of document.getAnimations()){a.pause();a.currentTime=t;}
    },n*40);
    await page.screenshot({path:path.join(temp,`${name}-${String(n).padStart(4,"0")}.png`)});
    if(n===0){
     await page.screenshot({path:path.join(output,name+".png")});
     await exportSvg(page,mode,height);
    }
   }
   if(errors.length)throw new Error(errors.join("\n"));
   // A 40ms copy of the entry frame makes the encoded loop boundary identical.
   fs.copyFileSync(path.join(temp,`${name}-0000.png`),path.join(temp,`${name}-${String(duration*25).padStart(4,"0")}.png`));
   const sequence=path.join(temp,name+"-%04d.png"),palette=path.join(temp,name+"-palette.png");
   ffmpeg("-framerate","25","-i",sequence,"-vf","palettegen=stats_mode=diff","-frames:v","1",palette);
   ffmpeg("-framerate","25","-i",sequence,"-i",palette,"-lavfi","paletteuse=dither=none:diff_mode=rectangle","-loop","0",path.join(output,name+".gif"));
   const size=fs.statSync(path.join(output,name+".gif")).size;
   if(size>2*1024*1024)throw new Error(name+" GIF exceeds the 2 MiB asset budget");
   console.log(`${name}: ${duration*25+1} frames, 900x${height}, ${Math.round(size/1024)} KiB`);
   await page.close();
  }
 } finally {await browser.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
