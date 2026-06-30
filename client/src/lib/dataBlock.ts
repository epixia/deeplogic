// dataBlock — generate a self-contained widget that pulls live from a database
// (Supabase PostgREST) and renders a KPI, bar, line, or table. The query is
// done client-side in the widget iframe using the publishable key (RLS-read).

export interface DataBlockConfig {
  url: string
  key: string
  table: string
  viz: 'kpi' | 'bar' | 'line' | 'table'
  metric: string
  agg: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'latest'
  dimension: string
  windowDays: number
  limit: number
  title: string
  columns?: string[] // table mode: which columns to show (empty = all)
}

export function buildDataBlockHtml(c: DataBlockConfig): string {
  const cfg = JSON.stringify({
    base: c.url.replace(/\/$/, '') + '/rest/v1/' + c.table,
    key: c.key, viz: c.viz, metric: c.metric, agg: c.agg, dim: c.dimension,
    windowDays: c.windowDays || 0, limit: c.limit || 5000, title: c.title,
    columns: c.columns || [],
  })
  return `<div style="height:100%;display:flex;flex-direction:column;font-family:inherit;color:var(--ink);padding:12px;box-sizing:border-box">
<div id="db-body" style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;justify-content:center">Loading…</div>
</div>
<script>(function(){
var C=${cfg};
var body=document.getElementById('db-body');
var H={apikey:C.key,Authorization:'Bearer '+C.key};
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(x){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[x]})}
function num(n){return (Math.round(n*100)/100).toLocaleString()}
var sel = C.viz==='table' ? '*' : (C.viz==='kpi' ? C.metric : (C.dim+','+C.metric));
var params=['select='+encodeURIComponent(sel),'limit='+C.limit];
if((C.viz==='line'||C.viz==='kpi') && C.windowDays>0 && C.dim){ params.push(encodeURIComponent(C.dim)+'=gte.'+encodeURIComponent(new Date(Date.now()-C.windowDays*86400000).toISOString())); }
if(C.viz==='table' && C.dim){ params.push('order='+encodeURIComponent(C.dim)+'.desc'); }
fetch(C.base+'?'+params.join('&'),{headers:H}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(render).catch(function(e){body.innerHTML='<div style="color:var(--mut)">'+esc(e.message)+'</div>'});
function agg(v){var n=v.length;if(C.agg==='count')return n;if(!n)return 0;if(C.agg==='avg')return v.reduce(function(a,b){return a+b},0)/n;if(C.agg==='min')return Math.min.apply(null,v);if(C.agg==='max')return Math.max.apply(null,v);if(C.agg==='latest')return v[v.length-1];return v.reduce(function(a,b){return a+b},0);}
function render(rows){
 if(!rows||!rows.length){body.innerHTML='<div style="color:var(--mut)">No data</div>';return;}
 if(C.viz==='kpi'){body.style.alignItems='center';var val=agg(rows.map(function(r){return Number(r[C.metric])}).filter(function(x){return !isNaN(x)}));body.innerHTML='<div style="text-align:center"><div style="font-size:40px;font-weight:800;line-height:1">'+num(val)+'</div><div style="font-size:11px;color:var(--mut);margin-top:4px">'+esc(C.agg)+' · '+esc(C.metric)+' · '+rows.length+' rows</div></div>';return;}
 if(C.viz==='table'){
   var allCols=Object.keys(rows[0]);
   var cols=(C.columns&&C.columns.length)?C.columns.filter(function(c){return allCols.indexOf(c)>=0}):allCols.slice(0,8);
   if(!cols.length)cols=allCols.slice(0,8);
   var sortCol=null,sortDir=1,q='';
   body.innerHTML='<input id="db-q" placeholder="Search…" style="width:100%;margin-bottom:7px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg2);color:var(--ink);font-size:12px;box-sizing:border-box;outline:none"><div id="db-tw" style="overflow:auto;flex:1;min-height:0"></div>';
   var tw=document.getElementById('db-tw');
   function draw(){
     var data=rows;
     if(q){var qq=q.toLowerCase();data=data.filter(function(r){return cols.some(function(c){return String(r[c]==null?'':r[c]).toLowerCase().indexOf(qq)>=0})})}
     if(sortCol!=null){data=data.slice().sort(function(a,b){var x=a[sortCol],y=b[sortCol],nx=Number(x),ny=Number(y);if(x!==''&&y!==''&&!isNaN(nx)&&!isNaN(ny))return (nx-ny)*sortDir;return String(x==null?'':x).localeCompare(String(y==null?'':y))*sortDir})}
     tw.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>'+cols.map(function(c){var ar=sortCol===c?(sortDir>0?' ▲':' ▼'):'';return '<th data-c="'+esc(c)+'" style="text-align:left;padding:6px 9px;border-bottom:1px solid var(--line);color:var(--mut);cursor:pointer;position:sticky;top:0;background:var(--card);user-select:none;white-space:nowrap;font-weight:600">'+esc(c)+ar+'</th>'}).join('')+'</tr></thead><tbody>'+data.slice(0,200).map(function(r){return '<tr>'+cols.map(function(c){return '<td style="padding:5px 9px;border-bottom:1px solid var(--line)">'+esc(r[c])+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table>'+(data.length>200?'<div style="font-size:10px;color:var(--mut);padding:6px">Showing 200 of '+data.length+' rows</div>':'');
     Array.prototype.forEach.call(tw.querySelectorAll('th'),function(th){th.onclick=function(){var c=th.getAttribute('data-c');if(sortCol===c)sortDir=-sortDir;else{sortCol=c;sortDir=1}draw()}});
   }
   document.getElementById('db-q').oninput=function(e){q=e.target.value;draw()};
   draw();return;
 }
 var g={};rows.forEach(function(r){var k=r[C.dim];if(C.viz==='line'&&k!=null)k=String(k).slice(0,10);if(k==null)k='—';var v=Number(r[C.metric]);if(isNaN(v))v=0;g[k]=(g[k]||0)+(C.agg==='count'?1:v);});
 var e=Object.keys(g).map(function(k){return [k,g[k]]});
 if(C.viz==='line'){e.sort(function(a,b){return a[0]<b[0]?-1:1});}else{e.sort(function(a,b){return b[1]-a[1]});e=e.slice(0,12);}
 var max=Math.max.apply(null,e.map(function(x){return x[1]}).concat([1]));
 if(C.viz==='bar'){body.innerHTML='<div style="display:flex;flex-direction:column;gap:6px">'+e.map(function(x){return '<div><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>'+esc(x[0])+'</span><span>'+num(x[1])+'</span></div><div style="height:8px;background:var(--bg2);border-radius:5px"><div style="height:100%;width:'+(x[1]/max*100)+'%;background:var(--cyan);border-radius:5px"></div></div></div>'}).join('')+'</div>';return;}
 body.innerHTML='<div style="display:flex;align-items:flex-end;gap:2px;height:100%;min-height:90px">'+e.map(function(x){return '<div title="'+esc(x[0])+': '+num(x[1])+'" style="flex:1;display:flex;align-items:flex-end;height:100%"><div style="width:100%;height:'+Math.max(2,x[1]/max*100)+'%;background:var(--cyan);border-radius:3px 3px 0 0"></div></div>'}).join('')+'</div>';
}
})();</script>`
}
