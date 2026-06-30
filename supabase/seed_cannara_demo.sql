-- ============================================================================
-- Cannara Biotech — DEMO cultivation + sales dataset (prefixed: cnra_*)
-- Tables are prefixed cnra_ so they NEVER collide with or drop your own tables.
-- Safe to re-run. Anon-readable so dashboard Blocks can read with the key.
-- ============================================================================

drop table if exists cnra_sales cascade;
drop table if exists cnra_harvests cascade;
drop table if exists cnra_room_sensor_readings cascade;
drop table if exists cnra_products cascade;
drop table if exists cnra_strains cascade;
drop table if exists cnra_rooms cascade;

create table cnra_rooms (
  id                  serial primary key,
  name                text not null,
  facility            text not null,
  room_type           text not null,
  strain              text,
  plant_count         int  default 0,
  area_sqft           int,
  target_temp_c       numeric(4,1),
  target_humidity_pct int,
  status              text default 'active'
);
insert into cnra_rooms (name, facility, room_type, strain, plant_count, area_sqft, target_temp_c, target_humidity_pct) values
  ('Flower Room A', 'Valleyfield', 'flower', 'Tribal Gathering', 1320, 6000, 24.0, 48),
  ('Flower Room B', 'Valleyfield', 'flower', 'Cannara OG',       1280, 6000, 24.0, 47),
  ('Flower Room C', 'Valleyfield', 'flower', 'Pink Kush',        1300, 6000, 23.5, 46),
  ('Flower Room D', 'Valleyfield', 'flower', 'Wedding Cake',     1250, 6000, 24.5, 48),
  ('Flower Room E', 'Farnham',     'flower', 'Blue Dream',       1180, 5200, 24.0, 47),
  ('Flower Room F', 'Farnham',     'flower', 'Gelato 41',        1210, 5200, 23.5, 46),
  ('Veg Room 1',    'Valleyfield', 'veg',    'Mixed',            2400, 4000, 25.5, 65),
  ('Veg Room 2',    'Farnham',     'veg',    'Mixed',            2100, 3600, 26.0, 64),
  ('Mother Room',   'Valleyfield', 'mother', 'Genetics Library',  180,  900, 24.0, 60),
  ('Clone Dome',    'Valleyfield', 'clone',  'Propagation',      3200, 1200, 25.0, 78),
  ('Drying Room 1', 'Valleyfield', 'drying', null,                  0, 1500, 18.0, 56),
  ('Drying Room 2', 'Farnham',     'drying', null,                  0, 1200, 18.0, 55);

create table cnra_strains (
  id serial primary key, name text not null, type text,
  thc_pct numeric(4,1), cbd_pct numeric(4,1), flower_weeks int
);
insert into cnra_strains (name, type, thc_pct, cbd_pct, flower_weeks) values
  ('Tribal Gathering','hybrid',22.4,0.1,9),
  ('Cannara OG','indica',24.8,0.2,9),
  ('Pink Kush','indica',25.6,0.1,8),
  ('Wedding Cake','hybrid',23.9,0.1,9),
  ('Blue Dream','sativa',21.2,0.2,10),
  ('Gelato 41','hybrid',24.1,0.1,9),
  ('Northern Lights','indica',19.8,0.3,8),
  ('Ghost Train Haze','sativa',22.7,0.1,11);

create table cnra_products (
  id serial primary key, sku text unique, name text not null,
  category text, strain text, format text,
  thc_pct numeric(4,1), cbd_pct numeric(4,1), price_cad numeric(7,2)
);
insert into cnra_products (sku, name, category, strain, format, thc_pct, cbd_pct, price_cad) values
  ('CNR-DF-001','Tribal Gathering 3.5g','dried-flower','Tribal Gathering','3.5g',22.4,0.1,27.95),
  ('CNR-DF-002','Cannara OG 3.5g','dried-flower','Cannara OG','3.5g',24.8,0.2,29.95),
  ('CNR-DF-003','Pink Kush 7g','dried-flower','Pink Kush','7g',25.6,0.1,49.95),
  ('CNR-DF-004','Wedding Cake 28g','dried-flower','Wedding Cake','28g',23.9,0.1,124.95),
  ('CNR-DF-005','Blue Dream 3.5g','dried-flower','Blue Dream','3.5g',21.2,0.2,26.95),
  ('CNR-PR-001','Gelato 41 Pre-Roll 3x0.5g','pre-roll','Gelato 41','1.5g',24.1,0.1,13.95),
  ('CNR-PR-002','Northern Lights Pre-Roll 10x0.4g','pre-roll','Northern Lights','4g',19.8,0.3,34.95),
  ('CNR-VP-001','Ghost Train Haze 510 Cart 1g','vape','Ghost Train Haze','1g',82.0,0.5,39.95),
  ('CNR-VP-002','Pink Kush 510 Cart 0.5g','vape','Pink Kush','0.5g',79.5,0.4,24.95),
  ('CNR-HS-001','Cannara OG Hash 2g','hash','Cannara OG','2g',42.0,0.3,21.95),
  ('CNR-ED-001','Mango Gummies 10mg THC','edible',null,'2-pack',0.0,0.0,5.95),
  ('CNR-ED-002','Dark Chocolate 10mg THC','edible',null,'1-pack',0.0,0.0,4.95);

create table cnra_room_sensor_readings (
  id           bigserial primary key,
  room_id      int references cnra_rooms(id) on delete cascade,
  recorded_at  timestamptz not null,
  temp_c       numeric(4,1),
  humidity_pct numeric(4,1),
  co2_ppm      int,
  vpd_kpa      numeric(3,2)
);
create index cnra_readings_idx on cnra_room_sensor_readings(room_id, recorded_at desc);

insert into cnra_room_sensor_readings (room_id, recorded_at, temp_c, humidity_pct, co2_ppm, vpd_kpa)
select
  r.id,
  d + interval '6 hours',
  round((r.target_temp_c + 1.0 * sin(extract(doy from d)/365.0*2*pi()) + (random()-0.5)*1.6
         + case when random() < 0.01 then (random()*4-1) else 0 end)::numeric, 1),
  round((r.target_humidity_pct + (random()-0.5)*8)::numeric, 1),
  case when r.room_type in ('flower','veg') then 900 + (random()*500)::int else 430 + (random()*120)::int end,
  round((0.8 + random()*0.6)::numeric, 2)
from cnra_rooms r
cross join generate_series((now() - interval '3 years')::date, now()::date, interval '1 day') d
where r.room_type in ('flower','veg','mother','clone','drying');

create table cnra_harvests (
  id serial primary key, room_id int references cnra_rooms(id), strain text,
  harvest_date date, wet_weight_g int, dry_weight_g int, grade text
);
insert into cnra_harvests (room_id, strain, harvest_date, wet_weight_g, dry_weight_g, grade)
select r.id, r.strain, d::date,
  (r.plant_count*(420+random()*180))::int,
  (r.plant_count*(90+random()*45))::int,
  (array['AAAA','AAA','AA','A'])[1+floor(random()*4)::int]
from cnra_rooms r
cross join generate_series((now() - interval '3 years')::date, now()::date, interval '70 days') d
where r.room_type = 'flower';

create table cnra_sales (
  id             bigserial primary key,
  occurred_at    timestamptz not null,
  product_id     int references cnra_products(id),
  category       text,
  channel        text,
  province       text,
  units          int,
  unit_price_cad numeric(7,2),
  discount_pct   numeric(4,1),
  gross_cad      numeric(10,2),
  total_cad      numeric(10,2)
);
create index cnra_sales_idx on cnra_sales(occurred_at desc);
create index cnra_sales_prod_idx on cnra_sales(product_id);

-- Realistic emulation: full product × channel mix per day, weighted by product
-- popularity & channel size, with a 3-year growth trend, weekly seasonality
-- (Fri/Sat lift), an annual wave, 4/20 + holiday + Canada-Day spikes, occasional
-- promo discounts, and noise. Rows that round to 0 units are dropped (not every
-- SKU sells in every province every day).
insert into cnra_sales (occurred_at, product_id, category, channel, province, units, unit_price_cad, discount_pct, gross_cad, total_cad)
with days as (
  select d::date as d,
         extract(epoch from (d - (now() - interval '3 years')::date)) / extract(epoch from interval '3 years') as t,
         extract(dow from d) as dow,
         extract(doy from d) as doy,
         to_char(d, 'MM-DD') as md
  from generate_series((now() - interval '3 years')::date, now()::date, interval '1 day') d
),
channels as (
  select * from (values
    ('SQDC','Quebec',1.00),
    ('OCS','Ontario',0.62),
    ('AGLC','Alberta',0.30),
    ('BCLDB','British Columbia',0.26),
    ('MBLL','Manitoba',0.12),
    ('NSLC','Nova Scotia',0.10),
    ('Wholesale','Quebec',0.22)
  ) as c(channel, province, weight)
),
prods as (
  select id, price_cad, category,
    case category
      when 'pre-roll'     then 1.4
      when 'dried-flower' then 1.0
      when 'vape'         then 0.85
      when 'edible'       then 0.70
      when 'hash'         then 0.45
      else 0.60 end as pop
  from cnra_products
)
select
  dd.d + (random() * interval '20 hours'),
  pr.id, pr.category, ch.channel, ch.province,
  u.units, pr.price_cad, u.disc,
  round((u.units * pr.price_cad)::numeric, 2),
  round((u.units * pr.price_cad * (1 - u.disc / 100.0))::numeric, 2)
from days dd
cross join channels ch
cross join prods pr
cross join lateral (
  select
    (case when random() < 0.12 then (10 + floor(random() * 20))::numeric else 0 end) as disc,
    greatest(0, round(
        7.0 * ch.weight * pr.pop                                                   -- base demand
      * (0.5 + dd.t * 1.2)                                                          -- 3-year growth
      * (1 + 0.30 * sin(dd.dow / 7.0 * 2 * pi()) + case when dd.dow in (5, 6) then 0.25 else 0 end)  -- weekly
      * (1 + 0.18 * sin(dd.doy / 365.0 * 2 * pi() - 1.2))                           -- annual wave
      * (case when dd.md = '04-20' then 2.6                                         -- 4/20
              when dd.md between '12-18' and '12-31' then 1.5                       -- holidays
              when dd.md = '07-01' then 1.4                                         -- Canada Day
              else 1 end)
      * (0.55 + random() * 0.95)                                                    -- noise
    ))::int as units
) u
where u.units > 0;

-- read access for dashboard Blocks (publishable/anon key)
do $$ declare t text;
begin
  foreach t in array array['cnra_rooms','cnra_strains','cnra_products','cnra_room_sensor_readings','cnra_harvests','cnra_sales'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_read', t);
    execute format('create policy %I on public.%I for select using (true);', t || '_read', t);
  end loop;
end $$;
