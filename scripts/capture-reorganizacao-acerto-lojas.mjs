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

async function capture() {
  console.log('Aguardando servidor Next.js na porta 3000...');
  await waitForServer();
  console.log('Servidor operacional.');

  const userDataDir = path.join(process.cwd(), '.chrome-user-data-capture-reorg');
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
    await cdp.send('DOM.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log('Navegando para o Estoque Digital MB Grupo...');
    await cdp.send('Page.navigate', { url: APP_URL });
    await wait(3000);

    // Navega para a aba Acerto entre Lojas
    console.log('Selecionando aba Acerto entre Lojas...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const links = Array.from(document.querySelectorAll('button, a'));
          const storeTab = links.find(el => el.textContent && el.textContent.includes('Acerto entre Lojas'));
          if (storeTab) {
            storeTab.click();
            return true;
          }
          return false;
        })()
      `,
    });

    await wait(1500);

    // 1. CAPTURA: Os dois painéis lado a lado
    console.log('Capturando Tela Principal (Dois Painéis Lado a Lado)...');
    const shotPanels = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const panelsPath = path.join(ARTIFACT_DIR, 'acerto_lojas_dois_paineis.png');
    fs.writeFileSync(panelsPath, Buffer.from(shotPanels.data, 'base64'));
    console.log('✓ Screenshot 1 salvo em:', panelsPath);

    // 2. CAPTURA: Modal Bia pegou de Carlos (Recebimento)
    console.log('Abrindo modal Registrar recebimento (Bia pegou de Carlos)...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const biaBtn = btns.find(b => b.textContent && b.textContent.includes('Registrar recebimento'));
          if (biaBtn) {
            biaBtn.click();
            return true;
          }
          return false;
        })()
      `,
    });

    await wait(1000);

    // Bipa uma peça de exemplo para demonstrar no modal da Bia
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const input = document.querySelector('input[placeholder*="Bipe ou digite o código"]');
          if (input) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, 'MB-0011-01');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          }
        })()
      `,
    });

    await wait(800);

    const shotBiaModal = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const biaModalPath = path.join(ARTIFACT_DIR, 'acerto_lojas_modal_bia_recebimento.png');
    fs.writeFileSync(biaModalPath, Buffer.from(shotBiaModal.data, 'base64'));
    console.log('✓ Screenshot 2 salvo em:', biaModalPath);

    // Fecha o modal da Bia
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Cancelar');
          if (cancelBtn) cancelBtn.click();
        })()
      `,
    });

    await wait(800);

    // 3. CAPTURA: Modal Carlos pegou de Bia (Retirada com Seleção Manual e Saldo)
    console.log('Abrindo modal Registrar retirada (Carlos pegou de Bia)...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const carlosBtn = btns.find(b => b.textContent && b.textContent.includes('Registrar retirada'));
          if (carlosBtn) {
            carlosBtn.click();
            return true;
          }
          return false;
        })()
      `,
    });

    await wait(1000);

    // Seleciona um produto no dropdown para exibir as variações e o saldo
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const selects = Array.from(document.querySelectorAll('select'));
          if (selects.length > 0) {
            const prodSelect = selects[0];
            if (prodSelect.options.length > 1) {
              prodSelect.selectedIndex = 1;
              prodSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        })()
      `,
    });

    await wait(800);

    const shotCarlosModal = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const carlosModalPath = path.join(ARTIFACT_DIR, 'acerto_lojas_modal_carlos_retirada.png');
    fs.writeFileSync(carlosModalPath, Buffer.from(shotCarlosModal.data, 'base64'));
    console.log('✓ Screenshot 3 salvo em:', carlosModalPath);

    cdp.close();
    console.log('✓ Todas as capturas visuais concluídas com sucesso!');
  } finally {
    chromeProcess.kill();
  }
}

capture().catch((err) => {
  console.error('Erro na captura:', err);
  process.exit(1);
});

