import { spawn } from 'child_process';
import http from 'http';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/json`, (resp) => {
          let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
      });
      if (res && res.length > 0) {
        const page = res.find(t => t.type === 'page') || res[0];
        if (page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      await wait(300);
    }
  }
  throw new Error('Falha ao conectar no Chrome');
}

async function run() {
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--user-data-dir=' + process.env.TEMP + '\\check_badge_' + Date.now(),
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await getWsUrl();
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

    let id = 1;
    const callbacks = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg.result || msg.error);
        callbacks.delete(msg.id);
      }
    };

    const send = (method, params = {}) => new Promise(resolve => {
      const reqId = id++;
      callbacks.set(reqId, resolve);
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'http://localhost:3000' });
    await wait(3000);

    const evalRes = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const portal = document.querySelector('nextjs-portal');
          if (!portal || !portal.shadowRoot) return { status: 'no-portal' };
          const badge = portal.shadowRoot.querySelector('[data-next-badge]');
          const errors = portal.shadowRoot.querySelectorAll('[data-nextjs-dialog-header], [data-next-badge][data-error="true"]');
          return {
            hasBadge: !!badge,
            badgeError: badge ? badge.getAttribute('data-error') : null,
            badgeText: badge ? badge.textContent.trim() : null,
            errorCount: errors.length,
            fullText: portal.shadowRoot.textContent.replace(/\\s+/g, ' ').substring(0, 500)
          };
        })()
      `,
      returnByValue: true
    });

    console.log('BADGE EVAL:', JSON.stringify(evalRes.result ? evalRes.result.value : evalRes, null, 2));
    ws.close();
  } finally {
    chrome.kill();
  }
}

run().catch(console.error);

