import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const APP_URL = 'http://localhost:3000';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWebSocketDebuggerUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/json`, (resp) => {
          let data = '';
          resp.on('data', (chunk) => (data += chunk));
          resp.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
      });
      if (res && res.length > 0) {
        const pageTarget = res.find((t) => t.type === 'page') || res[0];
        if (pageTarget.webSocketDebuggerUrl) {
          return pageTarget.webSocketDebuggerUrl;
        }
      }
    } catch {
      await wait(300);
    }
  }
  throw new Error('Falha ao obter WebSocket do Chrome');
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function capture() {
  const screenshotsDir = path.resolve('screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const chromeProcess = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1400,900',
      '--user-data-dir=' + process.env.TEMP + '\\banner_shot_profile_' + Date.now(),
    ],
    { stdio: 'ignore' }
  );

  try {
    const wsUrl = await getWebSocketDebuggerUrl();
    const cdp = new CDPClient(wsUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Pré-injeta a sessão autenticada de Administrador no sessionStorage
    const sessionPayload = JSON.stringify({
      user: {
        id: 'usr-admin-demo',
        name: 'Administrador',
        email: 'admin@mbgrupo.com.br',
        role: 'admin',
        title: 'Administrador de Estoque',
        isDemoUser: true,
        isActive: true,
      },
      token: 'simulated-local-session-token',
      expiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
      environment: 'development',
    });

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        try {
          sessionStorage.setItem('mb_grupo_auth_session_v2', '${sessionPayload.replace(/'/g, "\\'")}');
        } catch(e) {}
      `,
    });

    // 1. Viewport 1400px (Desktop Amplo)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1400,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    console.log('Navegando para http://localhost:3000 (1400px com sessão ativa)...');
    await cdp.send('Page.navigate', { url: APP_URL });
    await wait(3500);

    // Se ainda houver tela de login, clica no botão de demonstração rápida se houver
    const pageTitle = await cdp.send('Runtime.evaluate', {
      expression: 'document.body.innerText.substring(0, 300)',
    });
    console.log('Conteúdo inicial da página:', pageTitle.result.value.replace(/\n/g, ' '));

    const shot1400 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file1400 = path.join(screenshotsDir, 'dashboard_banner_1400px.png');
    fs.writeFileSync(file1400, Buffer.from(shot1400.data, 'base64'));
    console.log('✓ Screenshot 1400px salvo:', file1400);

    // Captura o elemento exato do banner
    const bannerBox = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const banner = document.querySelector('div.relative.overflow-hidden.rounded-2xl');
          if (!banner) return null;
          const rect = banner.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()
      `,
      returnByValue: true,
    });

    if (bannerBox.result && bannerBox.result.value) {
      const box = bannerBox.result.value;
      console.log('Banner coordinates:', box);
      const clipShot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: box.width,
          height: box.height,
          scale: 1,
        },
      });
      const clipFile = path.join(screenshotsDir, 'dashboard_banner_element.png');
      fs.writeFileSync(clipFile, Buffer.from(clipShot.data, 'base64'));
      console.log('✓ Screenshot Banner Element salvo:', clipFile);
    }

    // 2. Viewport 1200px (Desktop Padrão)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(1000);
    const shot1200 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file1200 = path.join(screenshotsDir, 'dashboard_banner_1200px.png');
    fs.writeFileSync(file1200, Buffer.from(shot1200.data, 'base64'));
    console.log('✓ Screenshot 1200px salvo:', file1200);

    // 3. Viewport 768px (Tablet / Resolução Compacta)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 768,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(1000);
    const shot768 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file768 = path.join(screenshotsDir, 'dashboard_banner_768px.png');
    fs.writeFileSync(file768, Buffer.from(shot768.data, 'base64'));
    console.log('✓ Screenshot 768px salvo:', file768);

    cdp.close();
  } finally {
    chromeProcess.kill();
  }
}

capture().catch(console.error);
