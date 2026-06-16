import { chromium } from 'playwright';

const DASHBOARDS = [
  { org: '7455538b-e7a9-4b8b-9ddc-d6b6549539a3', dash: '53bc6d60-c8d2-4c48-b018-44ac89e76717', name: 'Cannara Sales' },
  { org: '778d25f8-b222-4d00-8bf7-8025bfce8bfe', dash: '9b6fac3d-5228-4e57-a628-63bd46274d8e', name: 'Cannara Grow Lab' },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const patches = [];
page.on('request', req => {
  if (req.method() === 'PATCH' && req.url().includes('/widgets/'))
    patches.push({ url: req.url(), body: req.postData() });
});
page.on('response', async res => {
  if (res.request().method() === 'PATCH' && res.url().includes('/widgets/')) {
    let body = ''; try { body = await res.text(); } catch(e) {}
    patches.push({ status: res.status(), gridW: JSON.parse(body||'{}').gridW, gridH: JSON.parse(body||'{}').gridH });
  }
});

// Login once
await page.goto('http://localhost:5173/login');
await page.fill('input[type="email"]', 'michael@epixia.com');
await page.fill('input[type="password"]', 'test1234');
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);

for (const { org, dash, name } of DASHBOARDS) {
  console.log(`\n=== ${name} ===`);
  patches.length = 0;
  
  await page.goto(`http://localhost:5173/app/${org}/dashboards/${dash}`);
  await page.waitForTimeout(3000);
  
  const widgetCount = await page.$$eval('.react-grid-item', els => els.length);
  console.log('Widgets on grid:', widgetCount);
  
  if (widgetCount === 0) { console.log('No widgets - skip'); continue; }
  
  // Try clicking each preset button (S, M, L, T, W) via JS
  const presetBtns = await page.$$('.wg-preset-btn');
  console.log('Preset buttons found:', presetBtns.length);
  
  if (presetBtns.length > 0) {
    const active = await page.$eval('.wg-preset-btn.active', el => el.textContent).catch(() => 'none');
    console.log('Active preset:', active);
    
    // Click L button (or first one that isn't active)
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.wg-preset-btn')];
      const target = btns.find(b => !b.classList.contains('active')) || btns[0];
      if (target) { target.click(); return target.textContent; }
      return null;
    });
    console.log('Clicked preset:', clicked);
    await page.waitForTimeout(2500);
    
    const toast = await page.evaluate(() => {
      const el = document.querySelector('[style*="bottom: 20px"]');
      return el ? el.textContent : 'NO TOAST';
    });
    console.log('Toast:', toast);
    
    // Hard reload and check persistence
    await page.reload();
    await page.waitForTimeout(3000);
    const afterReload = await page.$eval('.wg-preset-btn.active', el => el.textContent).catch(() => 'none');
    console.log('Active after reload:', afterReload);
    console.log('Result:', afterReload === clicked ? '✓ PERSISTED' : `✗ LOST (got ${afterReload})`);
  }
  
  console.log('PATCH calls:', patches.map(p => JSON.stringify(p)).join(' | '));
}

await browser.close();
