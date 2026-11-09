const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage();
  page.on('requestfailed', request => console.log('failed', request.url(), request.failure()));
  page.on('response', response => console.log('response', response.status(), response.url()));
  await page.goto('https://example.com');
  console.log(await page.evaluate(() => new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve({ event: 'load', width: image.naturalWidth });
    image.onerror = () => resolve({ event: 'error', width: image.naturalWidth });
    image.src = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1845/2939';
    setTimeout(() => resolve({ event: 'timeout', complete: image.complete, width: image.naturalWidth }), 10000);
  })));
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
