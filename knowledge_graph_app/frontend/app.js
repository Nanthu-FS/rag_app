// ════════════════════════════════════════════════════════════════════════
//  Atlas — knowledge graph builder (vanilla, dependency-free)
// ════════════════════════════════════════════════════════════════════════
const TYPE_COLORS = {
  Person:"#4f46e5", Organization:"#0ea5e9", Place:"#10b981", Concept:"#f59e0b",
  Product:"#ec4899", Event:"#8b5cf6", Other:"#64748b",
};
const $ = (id) => document.getElementById(id);

// ── graph model ─────────────────────────────────────────────────────────
const G = {
  nodes:new Map(),      // id -> {id,name,type,count,x,y,vx,vy,r,appear,fixed}
  edges:[],             // {source,target,relation,count}
  edgeKey:new Set(),
};
let mode = "build";
let busy = false;
const hiddenTypes = new Set();

// focus / highlight state
let highlight = null;        // Set of node ids, or null = all visible
let focusEdges = new Set();   // "src|tgt" keys to emphasise
let pulse = 0;

// view transform
const view = { scale:1, tx:0, ty:0, tScale:1, tTx:0, tTy:0, animating:false };

// ── canvas ──────────────────────────────────────────────────────────────
let canvas, ctx, W=0, H=0, DPR=1;
let hoverId=null, dragId=null, dragMoved=false, panning=false;
let lastX=0, lastY=0;
const tip = document.createElement("div"); tip.className="graph-tip";

function initCanvas(){
  canvas = $("graph"); ctx = canvas.getContext("2d");
  canvas.parentElement.appendChild(tip);
  resize();
  window.addEventListener("resize", resize);
  canvas.addEventListener("wheel", onWheel, {passive:false});
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  requestAnimationFrame(loop);
}
function resize(){
  const r = canvas.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio||1, 2);
  W = r.width; H = r.height;
  canvas.width = W*DPR; canvas.height = H*DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
}

// world <-> screen
const toScreen = (x,y)=>[x*view.scale+view.tx, y*view.scale+view.ty];
const toWorld  = (sx,sy)=>[(sx-view.tx)/view.scale, (sy-view.ty)/view.scale];

// ── model mutation ──────────────────────────────────────────────────────
function addNodeData(nd){
  let n = G.nodes.get(nd.id);
  if(!n){
    const a = Math.random()*Math.PI*2, rad = 30+Math.random()*60;
    n = { id:nd.id, name:nd.name, type:nd.type||"Other", count:nd.count||1,
          x:(W/2-view.tx)/view.scale + Math.cos(a)*rad,
          y:(H/2-view.ty)/view.scale + Math.sin(a)*rad,
          vx:0, vy:0, r:6, appear:0, fixed:false };
    G.nodes.set(nd.id, n);
  } else {
    n.count = Math.max(n.count, nd.count||n.count);
    if(n.type==="Other" && nd.type && nd.type!=="Other") n.type=nd.type;
  }
  return n;
}
function addEdgeData(e){
  const k = e.source+"|"+e.relation+"|"+e.target;
  if(G.edgeKey.has(k)){ const ex=G.edges.find(x=>x.source===e.source&&x.relation===e.relation&&x.target===e.target); if(ex) ex.count++; return; }
  G.edgeKey.add(k);
  G.edges.push({source:e.source, target:e.target, relation:e.relation, count:e.count||1});
}
function degree(id){ let d=0; for(const e of G.edges){ if(e.source===id||e.target===id) d++; } return d; }
function recalcRadii(){ for(const n of G.nodes.values()) n.r = 6 + Math.sqrt(degree(n.id))*3; }

function loadGraph(vis){
  G.nodes.clear(); G.edges.length=0; G.edgeKey.clear();
  (vis.nodes||[]).forEach(addNodeData);
  (vis.edges||[]).forEach(addEdgeData);
  recalcRadii();
  // seed a circular layout
  let i=0, N=G.nodes.size;
  for(const n of G.nodes.values()){ const a=i/N*Math.PI*2; n.x=W/2+Math.cos(a)*220; n.y=H/2+Math.sin(a)*180; i++; }
  updateStats(vis.stats); buildLegend();
  setTimeout(fitView, 120);
}

// ── physics ─────────────────────────────────────────────────────────────
function step(){
  const nodes=[...G.nodes.values()];
  const REP=2600, SPRING=0.012, REST=86, CENTER=0.012, DAMP=0.86;
  for(const n of nodes){ n.fx=0; n.fy=0; }
  for(let i=0;i<nodes.length;i++){
    const a=nodes[i];
    for(let j=i+1;j<nodes.length;j++){
      const b=nodes[j];
      let dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy+0.01;
      const d=Math.sqrt(d2), f=REP/d2;
      const ux=dx/d, uy=dy/d;
      a.fx+=ux*f; a.fy+=uy*f; b.fx-=ux*f; b.fy-=uy*f;
    }
  }
  for(const e of G.edges){
    const a=G.nodes.get(e.source), b=G.nodes.get(e.target); if(!a||!b) continue;
    let dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)+0.01;
    const f=SPRING*(d-REST), ux=dx/d, uy=dy/d;
    a.fx+=ux*f; a.fy+=uy*f; b.fx-=ux*f; b.fy-=uy*f;
  }
  for(const n of nodes){
    n.fx += (W/2 - n.x)*CENTER; n.fy += (H/2 - n.y)*CENTER;
    if(n.fixed || n.id===dragId) continue;
    n.vx=(n.vx+n.fx)*DAMP; n.vy=(n.vy+n.fy)*DAMP;
    const sp=Math.hypot(n.vx,n.vy); if(sp>14){ n.vx=n.vx/sp*14; n.vy=n.vy/sp*14; }
    n.x+=n.vx; n.y+=n.vy;
    if(n.appear<1) n.appear=Math.min(1,n.appear+0.06);
  }
}

function fitView(){
  if(G.nodes.size===0) return;
  const set = highlight && highlight.size ? highlight : null;
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9, c=0;
  for(const n of G.nodes.values()){
    if(set && !set.has(n.id)) continue;
    minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x);maxY=Math.max(maxY,n.y);c++;
  }
  if(c===0) return;
  const pad=90, gw=Math.max(maxX-minX,1), gh=Math.max(maxY-minY,1);
  const s=Math.min((W-pad*2)/gw,(H-pad*2)/gh, 2.2);
  view.tScale=Math.max(0.25, s);
  view.tTx=W/2 - (minX+maxX)/2*view.tScale;
  view.tTy=H/2 - (minY+maxY)/2*view.tScale;
  view.animating=true;
}

// ── render ──────────────────────────────────────────────────────────────
function loop(){
  for(let s=0;s<2;s++) step();
  if(view.animating){
    view.scale+=(view.tScale-view.scale)*0.12;
    view.tx+=(view.tTx-view.tx)*0.12;
    view.ty+=(view.tTy-view.ty)*0.12;
    if(Math.abs(view.tScale-view.scale)<0.002){ view.scale=view.tScale; view.tx=view.tTx; view.ty=view.tTy; view.animating=false; }
  }
  pulse=(pulse+0.04)%1;
  draw();
  requestAnimationFrame(loop);
}

function isVisible(n){ return !hiddenTypes.has(n.type); }
function nodeDim(id){
  if(hiddenTypes.has(G.nodes.get(id)?.type)) return 0;
  if(!highlight) return 1;
  return highlight.has(id) ? 1 : 0.12;
}

function draw(){
  ctx.clearRect(0,0,W,H);
  // edges
  for(const e of G.edges){
    const a=G.nodes.get(e.source), b=G.nodes.get(e.target); if(!a||!b) continue;
    if(!isVisible(a)||!isVisible(b)) continue;
    const k=e.source+"|"+e.target, kr=e.target+"|"+e.source;
    const focused = focusEdges.has(k)||focusEdges.has(kr);
    let alpha = Math.min(nodeDim(a.id), nodeDim(b.id));
    if(focused) alpha=1;
    if(alpha<=0.02) continue;
    const [ax,ay]=toScreen(a.x,a.y), [bx,by]=toScreen(b.x,b.y);
    ctx.lineWidth = focused ? 2.4 : 1.1;
    ctx.strokeStyle = focused ? `rgba(26,26,24,${0.85})` : `rgba(150,150,140,${0.5*alpha})`;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
    // arrowhead
    const ang=Math.atan2(by-ay,bx-ax), br=(b.r*view.scale)+3;
    const ex=bx-Math.cos(ang)*br, ey=by-Math.sin(ang)*br, hl=focused?9:6;
    ctx.fillStyle=ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(ex,ey);
    ctx.lineTo(ex-Math.cos(ang-0.4)*hl, ey-Math.sin(ang-0.4)*hl);
    ctx.lineTo(ex-Math.cos(ang+0.4)*hl, ey-Math.sin(ang+0.4)*hl);
    ctx.closePath(); ctx.fill();
    // relation label when focused or an endpoint hovered
    const showLabel = focused || (hoverId && (hoverId===a.id||hoverId===b.id));
    if(showLabel){
      const mx=(ax+bx)/2, my=(ay+by)/2;
      ctx.font="600 11px Inter, sans-serif";
      const tw=ctx.measureText(e.relation).width;
      ctx.fillStyle="rgba(255,255,255,.92)";
      roundRect(mx-tw/2-7, my-9, tw+14, 18, 6); ctx.fill();
      ctx.fillStyle="#33332e"; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(e.relation, mx, my);
    }
    // travelling pulse dot on focused edges
    if(focused){
      const t=pulse, px=ax+(bx-ax)*t, py=ay+(by-ay)*t;
      ctx.beginPath(); ctx.arc(px,py,3.2,0,7); ctx.fillStyle="#1a1a18"; ctx.fill();
    }
  }
  // nodes
  for(const n of G.nodes.values()){
    if(!isVisible(n)) continue;
    const dim=nodeDim(n.id); if(dim<=0.02) continue;
    const [sx,sy]=toScreen(n.x,n.y);
    const r=(n.r*view.scale)*(0.4+0.6*n.appear);
    const col=TYPE_COLORS[n.type]||TYPE_COLORS.Other;
    const isHi = highlight && highlight.has(n.id);
    if(isHi || n.id===hoverId){
      ctx.beginPath(); ctx.arc(sx,sy,r+7,0,7);
      ctx.fillStyle=hexA(col,0.18); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(sx,sy,r,0,7);
    ctx.fillStyle=dim<1?hexA(col,0.85*dim+0.1):col; ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle=`rgba(255,255,255,${0.9*dim})`; ctx.stroke();
    // label
    if(view.scale>0.55 || isHi || n.id===hoverId){
      ctx.font=`${isHi?700:600} ${Math.max(11,12)}px Inter, sans-serif`;
      ctx.textAlign="center"; ctx.textBaseline="top";
      ctx.fillStyle=`rgba(26,26,24,${Math.max(.35,dim)})`;
      const label=n.name.length>22?n.name.slice(0,21)+"…":n.name;
      ctx.fillText(label, sx, sy+r+5);
    }
  }
}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function hexA(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;}

// ── picking & interaction ───────────────────────────────────────────────
function nodeAt(sx,sy){
  let best=null,bd=1e9;
  for(const n of G.nodes.values()){
    if(!isVisible(n)) continue;
    const [x,y]=toScreen(n.x,n.y); const d=Math.hypot(x-sx,y-sy), r=(n.r*view.scale)+6;
    if(d<r && d<bd){ bd=d; best=n; }
  }
  return best;
}
function onWheel(e){
  e.preventDefault();
  const f=e.deltaY<0?1.12:0.89;
  const [wx,wy]=toWorld(e.offsetX,e.offsetY);
  view.scale=Math.max(0.2,Math.min(4,view.scale*f));
  view.tx=e.offsetX-wx*view.scale; view.ty=e.offsetY-wy*view.scale;
  view.animating=false;
}
function onDown(e){
  const sx=e.offsetX, sy=e.offsetY;
  const n=nodeAt(sx,sy); dragMoved=false;
  if(n){ dragId=n.id; n.fixed=true; }
  else { panning=true; canvas.classList.add("grabbing"); }
  lastX=e.clientX; lastY=e.clientY; view.animating=false;
}
function onMove(e){
  const rect=canvas.getBoundingClientRect();
  const sx=e.clientX-rect.left, sy=e.clientY-rect.top;
  if(dragId){
    const n=G.nodes.get(dragId);
    n.x+= (e.clientX-lastX)/view.scale; n.y+=(e.clientY-lastY)/view.scale;
    n.vx=0; n.vy=0; dragMoved=true; lastX=e.clientX; lastY=e.clientY; return;
  }
  if(panning){
    view.tx+=e.clientX-lastX; view.ty+=e.clientY-lastY;
    lastX=e.clientX; lastY=e.clientY; return;
  }
  // hover
  const n=nodeAt(sx,sy);
  const id=n?n.id:null;
  if(id!==hoverId){
    hoverId=id;
    canvas.classList.toggle("pickable",!!id);
    if(id && !highlight){ /* light hover handled in draw via hoverId */ }
    updateTip(n,sx,sy);
  } else if(n){ updateTip(n,sx,sy); }
}
function onUp(e){
  if(dragId){ const n=G.nodes.get(dragId); if(n) setTimeout(()=>{n.fixed=false;},400);
    if(!dragMoved) selectNode(dragId); dragId=null; }
  if(panning){ panning=false; canvas.classList.remove("grabbing"); }
}
function updateTip(n,sx,sy){
  if(!n){ tip.classList.remove("show"); return; }
  tip.innerHTML=`<span class="tip-type">${n.type}</span><br>${n.name}`;
  tip.style.left=sx+"px"; tip.style.top=sy-(n.r*view.scale)-6+"px";
  tip.classList.add("show");
}
function selectNode(id){
  const nbrs=new Set([id]);
  for(const e of G.edges){ if(e.source===id) nbrs.add(e.target); if(e.target===id) nbrs.add(e.source); }
  highlight=nbrs; focusEdges=new Set();
  for(const e of G.edges){ if(e.source===id||e.target===id) focusEdges.add(e.source+"|"+e.target); }
  fitView();
}
function clearHighlight(){ highlight=null; focusEdges=new Set(); }

// ── stats / legend ──────────────────────────────────────────────────────
function updateStats(stats){
  if(!stats) stats={entities:G.nodes.size, relations:G.edges.length, by_type:{}};
  $("stat-ent").textContent=stats.entities ?? G.nodes.size;
  $("stat-rel").textContent=stats.relations ?? G.edges.length;
  if($("ph-ent")) $("ph-ent").textContent=stats.entities ?? G.nodes.size;
  if($("ph-rel")) $("ph-rel").textContent=stats.relations ?? G.edges.length;
}
function buildLegend(){
  const counts={};
  for(const n of G.nodes.values()) counts[n.type]=(counts[n.type]||0)+1;
  const order=Object.keys(TYPE_COLORS).filter(t=>counts[t]);
  $("legend").innerHTML="";
  for(const t of order){
    const row=document.createElement("div"); row.className="legend-row"+(hiddenTypes.has(t)?" off":"");
    row.innerHTML=`<span class="legend-dot" style="background:${TYPE_COLORS[t]}"></span>${t}<span class="lg-count">${counts[t]}</span>`;
    row.onclick=()=>{ hiddenTypes.has(t)?hiddenTypes.delete(t):hiddenTypes.add(t); buildLegend(); };
    $("legend").appendChild(row);
  }
}

// ── composer placement & wiring ─────────────────────────────────────────
function mountComposer(parent){
  const tpl=$("composer-tpl").content.cloneNode(true);
  parent.appendChild(tpl);
  const form=$("composer"), input=$("input"), fileInput=$("file");
  input.addEventListener("input",()=>{ input.style.height="auto"; input.style.height=Math.min(input.scrollHeight,200)+"px"; });
  input.addEventListener("keydown",(e)=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); form.requestSubmit(); }});
  form.addEventListener("submit",(e)=>{ e.preventDefault(); submit(); });
  $("mode").addEventListener("click",(e)=>{ const b=e.target.closest(".mode-pill"); if(!b)return;
    mode=b.dataset.mode; document.querySelectorAll(".mode-pill").forEach(p=>p.classList.toggle("active",p.dataset.mode===mode));
    input.placeholder = mode==="build" ? "Paste text to map…" : "Ask how two things connect, e.g. How is X connected to Y?";
  });
  $("attach").addEventListener("click",()=>fileInput.click());
  fileInput.addEventListener("change",()=>{ if(fileInput.files[0]) ingestFile(fileInput.files[0]); });
}
function setMode(m){ mode=m; document.querySelectorAll(".mode-pill").forEach(p=>p.classList.toggle("active",p.dataset.mode===m)); }

function goWorkspace(){
  if(!$("workspace").hidden) return;
  $("hero").hidden=true; $("workspace").hidden=false;
  initCanvas();
  $("dock-slot").appendChild($("composer"));  // re-parent the live composer
}

async function submit(){
  const input=$("input"); const text=input.value.trim();
  if(!text || busy) return;
  if(mode==="ask") return ask(text);
  return ingestText(text);
}

// ── ingest (streamed, live growth) ──────────────────────────────────────
async function ingestText(text){
  goWorkspace(); $("input").value=""; $("input").style.height="auto";
  const fd=new FormData(); fd.append("text",text);
  await runIngest(fd);
}
async function ingestFile(file){
  goWorkspace();
  const fd=new FormData(); fd.append("file",file);
  await runIngest(fd);
}
async function runIngest(fd){
  busy=true; $("send").disabled=true;
  const toast=$("ingest-toast"); toast.hidden=false;
  $("toast-title").textContent="Mapping…"; $("toast-sub").textContent="reading text";
  $("toast-bar-fill").style.width="3%";
  clearHighlight();
  try{
    const resp=await fetch("/api/ingest",{method:"POST",body:fd});
    await readNDJSON(resp,(evt)=>{
      if(evt.type==="start"){ $("toast-sub").textContent=`0 / ${evt.total} chunks`; }
      else if(evt.type==="delta"){
        for(const e of evt.edges){ addNodeData(e.source_node); addNodeData(e.target_node); addEdgeData(e); }
        recalcRadii(); buildLegend(); updateStats();
        $("toast-sub").textContent=`${evt.i} / ${evt.total} chunks · ${G.nodes.size} entities`;
        $("toast-bar-fill").style.width=Math.round(evt.i/evt.total*100)+"%";
      } else if(evt.type==="done"){
        if(evt.graph) loadGraph(evt.graph); else { updateStats(evt.stats); }
        $("toast-title").textContent="Done"; $("toast-bar-fill").style.width="100%";
        setTimeout(()=>{toast.hidden=true;},900);
      }
    });
  }catch(err){ $("toast-title").textContent="Error"; $("toast-sub").textContent=String(err.message||err); }
  finally{ busy=false; $("send").disabled=false; }
}

// ── ask (streamed answer + focus animation) ─────────────────────────────
async function ask(question){
  if(G.nodes.size===0){ ingestText(question); return; }  // nothing mapped yet → treat as text
  goWorkspace(); $("input").value=""; $("input").style.height="auto";
  busy=true; $("send").disabled=true;
  const card=$("answer"); card.hidden=false;
  const body=$("answer-body"); body.innerHTML="<p class='cursor'></p>";
  $("answer-note").textContent="thinking…"; $("intent-badge").textContent="…"; $("intent-badge").className="intent-badge";
  let answer="";
  try{
    const resp=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question})});
    await readNDJSON(resp,(evt)=>{
      if(evt.type==="focus"){
        applyFocus(evt);
      } else if(evt.type==="token"){
        answer+=evt.t; body.innerHTML=mdLite(answer)+"<span class='cursor'></span>"; body.scrollTop=body.scrollHeight;
      } else if(evt.type==="done"){
        body.innerHTML=mdLite(answer||"No answer.");
      }
    });
  }catch(err){ body.innerHTML=`<p>Connection error: ${err.message}. Is the server and Ollama running?</p>`; }
  finally{ busy=false; $("send").disabled=false; }
}
function applyFocus(evt){
  const intent=evt.intent||"connection";
  $("intent-badge").textContent=intent; $("intent-badge").className="intent-badge "+intent;
  $("answer-note").textContent=evt.note||"";
  const fn=new Set(evt.focus_nodes||[]);
  focusEdges=new Set();
  for(const e of (evt.focus_edges||[])){ focusEdges.add(e.source+"|"+e.target); }
  highlight = fn.size ? fn : null;
  fitView();
}

// ── streaming helper ────────────────────────────────────────────────────
async function readNDJSON(resp, onEvent){
  const reader=resp.body.getReader(); const dec=new TextDecoder(); let buf="";
  while(true){
    const {value,done}=await reader.read(); if(done) break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split("\n"); buf=lines.pop();
    for(const ln of lines){ if(ln.trim()){ try{ onEvent(JSON.parse(ln)); }catch{} } }
  }
  if(buf.trim()){ try{ onEvent(JSON.parse(buf)); }catch{} }
}
function mdLite(t){
  let h=t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  h=h.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/`([^`]+)`/g,"<code>$1</code>");
  return h.split(/\n{2,}/).map(p=>`<p>${p.replace(/\n/g,"<br>")}</p>`).join("");
}

// ── chrome wiring ───────────────────────────────────────────────────────
function wireChrome(){
  $("rail-new").addEventListener("click",()=>{
    clearHighlight(); $("answer").hidden=true;
    if(!$("workspace").hidden){ $("hero").appendChild($("composer")); $("workspace").hidden=true; $("hero").hidden=false; setMode("build"); }
  });
  $("toggle-panel").addEventListener("click",()=>$("panel").classList.toggle("hidden"));
  $("hero-hints").addEventListener("click",(e)=>{ if(e.target.dataset.sample){ loadSample(); }});
}
function wireWorkspaceButtons(){
  document.addEventListener("click",(e)=>{
    if(e.target.id==="btn-fit"){ clearHighlight(); fitView(); }
    if(e.target.id==="btn-clear"){ resetAll(); }
    if(e.target.id==="answer-close"){ $("answer").hidden=true; clearHighlight(); fitView(); }
  });
}
async function resetAll(){
  await fetch("/api/reset",{method:"POST"});
  G.nodes.clear(); G.edges.length=0; G.edgeKey.clear(); clearHighlight();
  updateStats({entities:0,relations:0}); buildLegend(); $("answer").hidden=true;
}
const SAMPLE=`Nimbus is a collaborative analytics company founded in 2019 by Elena Marsh and Raj Patel in Austin, Texas. Elena Marsh previously worked at Snowflake, where she met Raj Patel. Together they raised a seed round from Foundry Capital, led by partner Dana Cole. Nimbus builds a product called Nimbus Cloud, which integrates with Snowflake and BigQuery. In 2021, Nimbus acquired Vizly, a data-visualization startup based in Seattle, founded by Marco Reyes, who joined Nimbus as Head of Design. Dana Cole also sits on the board of Foundry Capital and previously invested in Snowflake. In 2023, Nimbus partnered with Microsoft to offer Nimbus Cloud on Azure, announced at the Microsoft Build conference, where Marco Reyes presented a design system called Aurora.`;
function loadSample(){ setMode("build"); ingestText(SAMPLE); }

// ── boot ────────────────────────────────────────────────────────────────
mountComposer($("hero-slot"));
wireChrome(); wireWorkspaceButtons();
fetch("/api/health").then(r=>r.json()).then(d=>{
  updateStats(d.stats);
  if(d.stats && d.stats.entities>0){ goWorkspace(); fetch("/api/graph").then(r=>r.json()).then(loadGraph); }
}).catch(()=>{});
