-- Cannara Mission Control — a real, editable dashboard seeded with live blocks
-- that read the cnra_* demo data straight from Supabase (PostgREST + publishable
-- key). A hands-on testing ground for the Block system. Re-runnable.
do $$
declare
  v_org    uuid := 'f6437ab3-e1fc-444b-b532-9337d32047c0';
  v_owner  uuid := '250007e8-a79f-41de-8b85-6259dafa4a6e';
  v_dash   uuid;
  k_sb     text := 'sb_publishable_ez6OsIfauoLGtgBJj2Gm_A_Kmep2HYR';
  u_sb     text := 'https://gfuxnyjeouyomdsdkqve.supabase.co/rest/v1';
begin
  delete from widgets where org_id = v_org and dashboard_id in
    (select id from dashboards where org_id = v_org and slug = 'cannara-mission-control');
  delete from dashboards where org_id = v_org and slug = 'cannara-mission-control';

  insert into dashboards (org_id, owner_id, name, slug, visibility, group_name, description)
  values (v_org, v_owner, 'Cannara Mission Control', 'cannara-mission-control', 'private', 'Demo',
          'Live operations demo — blocks read the cnra_* dataset from Supabase.')
  returning id into v_dash;

  insert into widgets (org_id, dashboard_id, owner_id, name, type, html, grid_x, grid_y, grid_w, grid_h) values
  -- KPI: revenue 30d
  (v_org, v_dash, v_owner, 'Revenue · 30 days', 'chart',
   '<div style="height:100%;display:flex;flex-direction:column;justify-content:center;font-family:inherit;color:var(--ink)"><div style="font-size:12px;color:var(--mut);font-weight:600">Revenue · 30 days</div><div id="v" style="font-size:36px;font-weight:800;line-height:1.1">…</div></div><script>(function(){var K="' || k_sb || '",U="' || u_sb || '/cnra_sales?select=total_cad&limit=20000&occurred_at=gte."+new Date(Date.now()-2592000000).toISOString();fetch(U,{headers:{apikey:K,Authorization:"Bearer "+K}}).then(function(r){return r.json()}).then(function(x){var s=x.reduce(function(a,b){return a+Number(b.total_cad)},0);document.getElementById("v").textContent="$"+Math.round(s).toLocaleString()}).catch(function(){document.getElementById("v").textContent="—"})})();</script>',
   0, 0, 2, 2),
  -- KPI: units 30d
  (v_org, v_dash, v_owner, 'Units · 30 days', 'chart',
   '<div style="height:100%;display:flex;flex-direction:column;justify-content:center;font-family:inherit;color:var(--ink)"><div style="font-size:12px;color:var(--mut);font-weight:600">Units sold · 30 days</div><div id="v" style="font-size:36px;font-weight:800;line-height:1.1">…</div></div><script>(function(){var K="' || k_sb || '",U="' || u_sb || '/cnra_sales?select=units&limit=20000&occurred_at=gte."+new Date(Date.now()-2592000000).toISOString();fetch(U,{headers:{apikey:K,Authorization:"Bearer "+K}}).then(function(r){return r.json()}).then(function(x){var s=x.reduce(function(a,b){return a+Number(b.units)},0);document.getElementById("v").textContent=s.toLocaleString()}).catch(function(){document.getElementById("v").textContent="—"})})();</script>',
   2, 0, 2, 2),
  -- KPI: plants in canopy
  (v_org, v_dash, v_owner, 'Plants in canopy', 'chart',
   '<div style="height:100%;display:flex;flex-direction:column;justify-content:center;font-family:inherit;color:var(--ink)"><div style="font-size:12px;color:var(--mut);font-weight:600">Plants in canopy</div><div id="v" style="font-size:36px;font-weight:800;line-height:1.1">…</div></div><script>(function(){var K="' || k_sb || '",U="' || u_sb || '/cnra_rooms?select=plant_count&limit=100";fetch(U,{headers:{apikey:K,Authorization:"Bearer "+K}}).then(function(r){return r.json()}).then(function(x){var s=x.reduce(function(a,b){return a+Number(b.plant_count)},0);document.getElementById("v").textContent=s.toLocaleString()}).catch(function(){document.getElementById("v").textContent="—"})})();</script>',
   4, 0, 2, 2),
  -- Bar: revenue by channel 30d
  (v_org, v_dash, v_owner, 'Revenue by channel', 'chart',
   '<div style="height:100%;font-family:inherit;color:var(--ink)"><div style="font-size:12px;color:var(--mut);font-weight:600;margin-bottom:8px">Revenue by channel · 30d</div><div id="b">…</div></div><script>(function(){var K="' || k_sb || '",U="' || u_sb || '/cnra_sales?select=channel,total_cad&limit=20000&occurred_at=gte."+new Date(Date.now()-2592000000).toISOString();fetch(U,{headers:{apikey:K,Authorization:"Bearer "+K}}).then(function(r){return r.json()}).then(function(x){var g={};x.forEach(function(r){g[r.channel]=(g[r.channel]||0)+Number(r.total_cad)});var e=Object.keys(g).map(function(k){return[k,g[k]]}).sort(function(a,b){return b[1]-a[1]});var m=Math.max.apply(null,e.map(function(z){return z[1]}).concat([1]));document.getElementById("b").innerHTML=e.map(function(z){return ''<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>''+z[0]+''</span><span>$''+Math.round(z[1]).toLocaleString()+''</span></div><div style="height:8px;background:var(--bg2);border-radius:5px"><div style="height:100%;width:''+(z[1]/m*100)+''%;background:var(--cyan);border-radius:5px"></div></div></div>''}).join("")}).catch(function(){document.getElementById("b").textContent="—"})})();</script>',
   0, 2, 3, 3),
  -- Line: daily sales 30d
  (v_org, v_dash, v_owner, 'Daily sales · 30d', 'chart',
   '<div style="height:100%;display:flex;flex-direction:column;font-family:inherit;color:var(--ink)"><div style="font-size:12px;color:var(--mut);font-weight:600;margin-bottom:8px">Daily sales · 30d</div><div id="b" style="flex:1">…</div></div><script>(function(){var K="' || k_sb || '",U="' || u_sb || '/cnra_sales?select=occurred_at,total_cad&limit=20000&occurred_at=gte."+new Date(Date.now()-2592000000).toISOString();fetch(U,{headers:{apikey:K,Authorization:"Bearer "+K}}).then(function(r){return r.json()}).then(function(x){var g={};x.forEach(function(r){var d=String(r.occurred_at).slice(0,10);g[d]=(g[d]||0)+Number(r.total_cad)});var e=Object.keys(g).sort().map(function(k){return[k,g[k]]});var m=Math.max.apply(null,e.map(function(z){return z[1]}).concat([1]));document.getElementById("b").innerHTML=''<div style="display:flex;align-items:flex-end;gap:2px;height:100%;min-height:90px">''+e.map(function(z){return ''<div title="''+z[0]+'': $''+Math.round(z[1]).toLocaleString()+''" style="flex:1;display:flex;align-items:flex-end;height:100%"><div style="width:100%;height:''+Math.max(2,z[1]/m*100)+''%;background:var(--cyan);border-radius:3px 3px 0 0"></div></div>''}).join("")+''</div>''}).catch(function(){document.getElementById("b").textContent="—"})})();</script>',
   3, 2, 3, 3),
  -- Table: recent harvests
  (v_org, v_dash, v_owner, 'Recent harvests', 'table',
   '<div style="height:100%;font-family:inherit;color:var(--ink)"><div style="font-size:12px;color:var(--mut);font-weight:600;margin-bottom:8px">Recent harvests</div><div id="b">…</div></div><script>(function(){var K="' || k_sb || '",U="' || u_sb || '/cnra_harvests?select=harvest_date,strain,dry_weight_g,grade&order=harvest_date.desc&limit=12";fetch(U,{headers:{apikey:K,Authorization:"Bearer "+K}}).then(function(r){return r.json()}).then(function(x){document.getElementById("b").innerHTML=''<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);color:var(--mut)">Date</th><th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);color:var(--mut)">Strain</th><th style="text-align:right;padding:4px 6px;border-bottom:1px solid var(--line);color:var(--mut)">Dry (kg)</th><th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);color:var(--mut)">Grade</th></tr></thead><tbody>''+x.map(function(r){return ''<tr><td style="padding:4px 6px;border-bottom:1px solid var(--line)">''+r.harvest_date+''</td><td style="padding:4px 6px;border-bottom:1px solid var(--line)">''+r.strain+''</td><td style="padding:4px 6px;border-bottom:1px solid var(--line);text-align:right">''+(r.dry_weight_g/1000).toFixed(1)+''</td><td style="padding:4px 6px;border-bottom:1px solid var(--line)">''+r.grade+''</td></tr>''}).join("")+''</tbody></table>''}).catch(function(){document.getElementById("b").textContent="—"})})();</script>',
   0, 5, 6, 3);
end $$;
