const fs = require('node:fs');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const views = [...html.matchAll(/data-view="([^"]+)"[^>]*>([^<]+)</g)].map(m => ({ view: m[1], label: m[2].trim() }));
const panels = [...new Set([...html.matchAll(/data-panel="([^"]+)"/g)].map(m => m[1]))];
console.log(JSON.stringify({ sidebar: views, panels }, null, 2));
