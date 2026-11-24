import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.WIDGET_DEMO_PORT || 4173);
const origin = (
  process.env.KLEVA_BACKEND_ORIGIN || 'http://localhost:3000'
).replace(/\/$/, '');
const widgetId = process.env.WEBSITE_WIDGET_PUBLIC_ID || '';
const page = await readFile(
  resolve('apps/chat-widget-demo/index.html'),
  'utf8',
);
const html = page.replace(
  '<!-- KLEVA_WIDGET -->',
  widgetId
    ? `<script async src="${origin}/public/widget.js" data-widget-id="${widgetId}"></script>`
    : '<aside class="setup">Set WEBSITE_WIDGET_PUBLIC_ID after creating a widget in Kleva, and authorize http://localhost:4173.</aside>',
);
createServer((_request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(html);
}).listen(port, '127.0.0.1', () =>
  console.log(`Kleva chat demo: http://localhost:${port}`),
);
