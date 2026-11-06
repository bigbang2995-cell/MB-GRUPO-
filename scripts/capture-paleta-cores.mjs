import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const APP_URL = 'http://localhost:3000';
const ARTIFACT_DIR = 'C:\\Users\\Pichau\\.gemini\\antigravity\\brain\\fca3eba7-24bf-443a-9cc5-13c492a08a19';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(APP_URL, (res) => {
          if (res.statusCode) resolve(true);
          else reject();
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject();
        });
      });
      return true;
    } catch {
      await wait(1000);
    }
  }
  throw new Error('Servidor não respondeu na porta 3000');
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
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('Aguardando servidor Next.js na porta 3000...');
  await waitForServer();
  console.log('Servidor operacional.');

  const userDataDir = path.join(process.cwd(), '.chrome-user-data-capture-paleta');
  if (fs.existsSync(userDataDir)) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('Iniciando Google Chrome em modo headless...');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1440,960',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    const wsUrl = await getWebSocketDebuggerUrl();
    const cdp = new CDPClient(wsUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    // Injeta sessão de Administrador no sessionStorage
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

    // 1. DESKTOP VIEWPORT (1440x960)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log('Navegando para o Estoque Digital MB Grupo (com sessão autenticada)...');
    await cdp.send('Page.navigate', { url: APP_URL });
    await wait(3500);

    // Clica na aba "Acerto entre Lojas"
    console.log('Selecionando aba Acerto entre Lojas...');
    const clickTab = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const links = Array.from(document.querySelectorAll('button, a'));
          const storeTab = links.find(el => el.textContent && el.textContent.includes('Acerto entre Lojas'));
          if (storeTab) {
            storeTab.click();
            return { clicked: true, text: storeTab.textContent };
          }
          return { clicked: false, available: links.map(l => l.textContent.trim()).filter(Boolean).slice(0, 15) };
        })()
      `,
      returnByValue: true,
    });
    console.log('Resultado do clique na aba:', clickTab.result.value);

    await wait(1500);

    // 1.1 Captura Desktop
    console.log('Capturando Desktop (Dois Painéis com Nova Paleta)...');
    const shotDesktop = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const desktopPath = path.join(ARTIFACT_DIR, 'acerto_lojas_paleta_desktop.png');
    fs.writeFileSync(desktopPath, Buffer.from(shotDesktop.data, 'base64'));
    console.log('✓ Screenshot Desktop salvo em:', desktopPath);

    // Atualiza também acerto_lojas_dois_paineis.png
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'acerto_lojas_dois_paineis.png'), Buffer.from(shotDesktop.data, 'base64'));

    // 1.2 Captura em destaque do elemento exato dos dois painéis
    console.log('Capturando elemento em destaque dos Dois Painéis...');
    const panelsBox = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('.grid.grid-cols-1.lg\\\\:grid-cols-2.gap-6') || document.querySelector('.grid.grid-cols-1');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()
      `,
      returnByValue: true,
    });

    if (panelsBox.result && panelsBox.result.value) {
      const box = panelsBox.result.value;
      const clipShot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: box.width,
          height: Math.min(box.height, 800),
          scale: 1,
        },
      });
      const cropPath = path.join(ARTIFACT_DIR, 'acerto_lojas_dois_paineis_destaque.png');
      fs.writeFileSync(cropPath, Buffer.from(clipShot.data, 'base64'));
      console.log('✓ Screenshot Destaque salvo em:', cropPath);
    }

    // 2. MOBILE VIEWPORT (390x844 - iPhone / Smartphone padrão)
    console.log('Alternando para viewport Mobile (390x844)...');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });

    await wait(1000);

    console.log('Capturando Mobile (Empilhamento Vertical Responsivo)...');
    const shotMobile = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const mobilePath = path.join(ARTIFACT_DIR, 'acerto_lojas_paleta_mobile.png');
    fs.writeFileSync(mobilePath, Buffer.from(shotMobile.data, 'base64'));
    console.log('✓ Screenshot Mobile salvo em:', mobilePath);

    console.log('✓ Todas as capturas de validação de cores concluídas com sucesso!');
    cdp.close();
  } finally {
    try {
      chromeProcess.kill();
    } catch {}
  }
}

run().catch((err) => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
