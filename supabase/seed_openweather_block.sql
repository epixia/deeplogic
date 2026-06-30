insert into public.gallery_blocks (slug, name, icon, category, tagline, description, size_w, size_h, fields, html_template, docs_url, enabled)
values (
  'openweather-current',
  'OpenWeather — Current',
  '🌦',
  'data',
  'Live local weather',
  'Current conditions for any location via the OpenWeather One Call API. Add your OpenWeather API key and coordinates in this block''s settings.',
  2, 2,
  $f$[
    {"key":"apiKey","label":"OpenWeather API key","type":"text","placeholder":"your appid","help":"One Call 3.0 needs the (free-tier) One Call subscription enabled.","helpUrl":"https://home.openweathermap.org/api_keys","helpLabel":"Get a free key →"},
    {"key":"lat","label":"Latitude","type":"text","default":"45.50","placeholder":"45.50"},
    {"key":"lon","label":"Longitude","type":"text","default":"-73.57","placeholder":"-73.57"},
    {"key":"units","label":"Units","type":"select","default":"metric","options":[{"value":"metric","label":"Celsius"},{"value":"imperial","label":"Fahrenheit"},{"value":"standard","label":"Kelvin"}]}
  ]$f$::jsonb,
  $tpl$<div id="ow" style="height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:4px;font-family:inherit;color:var(--ink);text-align:center">
  <div style="font-size:13px;color:var(--mut)">Loading weather...</div>
</div>
<script>(function(){
  var KEY="{{apiKey}}", LAT="{{lat}}", LON="{{lon}}", UNITS="{{units}}"||"metric";
  var el=document.getElementById('ow');
  if(!KEY){el.innerHTML='<div style="color:var(--mut);padding:12px">Add your OpenWeather API key in this block settings.</div>';return;}
  var unit=UNITS==='imperial'?'°F':(UNITS==='standard'?'K':'°C');
  var u="https://api.openweathermap.org/data/3.0/onecall?lat="+encodeURIComponent(LAT)+"&lon="+encodeURIComponent(LON)+"&units="+encodeURIComponent(UNITS)+"&exclude=minutely,hourly,daily,alerts&appid="+encodeURIComponent(KEY);
  fetch(u).then(function(r){if(!r.ok)throw new Error('API '+r.status);return r.json();}).then(function(j){
    var c=j.current||{}, w=(c.weather&&c.weather[0])||{};
    var icon=w.icon?'<img alt="" src="https://openweathermap.org/img/wn/'+w.icon+'@2x.png" style="width:84px;height:84px">':'<div style="font-size:46px">🌡</div>';
    el.innerHTML=icon+
      '<div style="font-size:34px;font-weight:700;line-height:1">'+Math.round(c.temp)+unit+'</div>'+
      '<div style="color:var(--mut);text-transform:capitalize">'+(w.description||'')+'</div>'+
      '<div style="font-size:12px;color:var(--mut2)">Feels '+Math.round(c.feels_like)+unit+' · Humidity '+(c.humidity!=null?c.humidity+'%':'-')+'</div>';
  }).catch(function(e){el.innerHTML='<div style="color:var(--mut);padding:12px">Could not load weather: '+e.message+'</div>';});
})();</script>$tpl$,
  'https://openweathermap.org/api/one-call-3',
  true
)
on conflict (slug) do update set
  name = excluded.name, icon = excluded.icon, category = excluded.category,
  tagline = excluded.tagline, description = excluded.description,
  size_w = excluded.size_w, size_h = excluded.size_h,
  fields = excluded.fields, html_template = excluded.html_template,
  docs_url = excluded.docs_url, enabled = excluded.enabled, updated_at = now();
