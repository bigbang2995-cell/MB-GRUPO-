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
    try {
      this.ws.close();
    } catch {}
  }
}

async function capture() {
  console.log('Aguardando servidor dev inicializar...');
  await waitForServer();
  console.log('Servidor dev ativo em http://localhost:3000');

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
      '--user-data-dir=' + process.env.TEMP + '\\acerto_shot_profile_' + Date.now(),
    ],
    { stdio: 'ignore' }
  );

  try {
    const wsUrl = await getWebSocketDebuggerUrl();
    const cdp = new CDPClient(wsUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Pré-injeta sessão autenticada de Administrador
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

    // Injeta transferências de demonstração
    const demoTransfers = JSON.stringify([
      {
        id: 'trans-demo-001',
        direction: 'bia_from_carlos',
        originStore: 'Loja do Carlos',
        destinationStore: 'Loja da Bia',
        productId: 'prod-0011',
        productName: 'Jaqueta lã batida',
        sku: '0011',
        variantId: 'var-0011-04',
        color: 'Preta (+4)',
        size: 'TU',
        barcode: 'MB-0011-04',
        quantity: 3,
        unitPrice: 89.9,
        totalPrice: 269.7,
        createdAt: new Date().toISOString(),
        operatorId: 'usr-admin-demo',
        operatorName: 'Administrador',
        method: 'scanner',
        isSettled: false,
        note: 'Repasse para vitrine',
      },
      {
        id: 'trans-demo-002',
        direction: 'carlos_from_bia',
        originStore: 'Loja da Bia',
        destinationStore: 'Loja do Carlos',
        productId: 'prod-0025',
        productName: 'Saída de praia',
        sku: '0025',
        variantId: 'var-0025-01',
        color: 'Bege (+2)',
        size: 'TU',
        barcode: 'MB-0025-01',
        quantity: 2,
        unitPrice: 55.0,
        totalPrice: 110.0,
        createdAt: new Date().toISOString(),
        operatorId: 'usr-admin-demo',
        operatorName: 'Administrador',
        method: 'manual',
        isSettled: false,
        note: 'Atendimento a cliente da loja',
      },
    ]);

    // Injeta alguns preços de demonstração na tabela
    const demoPrices = JSON.stringify({
      'var-0011-01': {
        variantId: 'var-0011-01',
        productId: 'prod-0011',
        sku: '0011',
        barcode: 'MB-0011-01',
        transferPrice: 79.9,
        updatedAt: new Date().toISOString(),
        updatedBy: 'usr-admin-demo',
        updatedByName: 'Administrador',
      },
      'var-0011-02': {
        variantId: 'var-0011-02',
        productId: 'prod-0011',
        sku: '0011',
        barcode: 'MB-0011-02',
        transferPrice: 79.9,
        updatedAt: new Date().toISOString(),
        updatedBy: 'usr-admin-demo',
        updatedByName: 'Administrador',
      },
      'var-0025-01': {
        variantId: 'var-0025-01',
        productId: 'prod-0025',
        sku: '0025',
        barcode: 'MB-0025-01',
        transferPrice: 55.0,
        updatedAt: new Date().toISOString(),
        updatedBy: 'usr-admin-demo',
        updatedByName: 'Administrador',
      },
    });

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        try {
          sessionStorage.setItem('mb_grupo_auth_session_v2', '${sessionPayload.replace(/'/g, "\\'")}');
          localStorage.setItem('MB_GRUPO_STORE_TRANSFERS_V1', '${demoTransfers.replace(/'/g, "\\'")}');
          localStorage.setItem('MB_GRUPO_STORE_TRANSFER_PRICES_V1', '${demoPrices.replace(/'/g, "\\'")}');
        } catch(e) {}
      `,
    });

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1400,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log('Navegando para o sistema...');
    await cdp.send('Page.navigate', { url: APP_URL });
    await wait(3500);

    // Clica na nova aba "Acerto entre Lojas"
    console.log('Clicando na aba Acerto entre Lojas...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const allBtns = Array.from(document.querySelectorAll('button'));
          const target = allBtns.find(b => b.textContent && b.textContent.includes('Acerto entre Lojas'));
          if (target) {
            target.click();
            return true;
          }
          return false;
        })()
      `,
    });

    await wait(1500);

    // 1. Captura da tela principal de Acerto entre Lojas (Dashboard de Lançamentos)
    console.log('Capturando tela principal de Acerto entre Lojas...');
    const shotMain = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const mainPath = path.join(screenshotsDir, 'acerto_lojas_dashboard.png');
    fs.writeFileSync(mainPath, Buffer.from(shotMain.data, 'base64'));
    console.log('✓ Screenshot Dashboard salvo em:', mainPath);

    // 2. Clica na sub-aba "Preços das Peças"
    console.log('Acessando aba Preços das Peças...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const pricesBtn = btns.find(b => b.textContent && b.textContent.includes('Preços das Peças'));
          if (pricesBtn) {
            pricesBtn.click();
            return true;
          }
          return false;
        })()
      `,
    });

    await wait(1200);

    const shotPrices = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const pricesPath = path.join(screenshotsDir, 'acerto_lojas_tabela_precos.png');
    fs.writeFileSync(pricesPath, Buffer.from(shotPrices.data, 'base64'));
    console.log('✓ Screenshot Tabela de Preços salvo em:', pricesPath);

    // 3. Abre o modal "Editar valor" na primeira linha
    console.log('Abrindo modal de edição de valor de repasse...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const editBtn = btns.find(b => b.textContent && (b.textContent.includes('Editar valor') || b.textContent.includes('Cadastrar valor')));
          if (editBtn) {
            editBtn.click();
            return true;
          }
          return false;
        })()
      `,
    });

    await wait(800);

    const shotModalPrice = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const modalPricePath = path.join(screenshotsDir, 'acerto_lojas_modal_editar_preco.png');
    fs.writeFileSync(modalPricePath, Buffer.from(shotModalPrice.data, 'base64'));
    console.log('✓ Screenshot Modal Editar Preço salvo em:', modalPricePath);

    // Fecha o modal de edição de preço
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Cancelar');
          if (cancelBtn) cancelBtn.click();
        })()
      `,
    });

    await wait(500);

    // 4. Volta para a aba Lançamentos e abre o Painel de Bipagem
    console.log('Abrindo modal Novo Lançamento (Painel de Bipagem)...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const lancBtn = btns.find(b => b.textContent && b.textContent.includes('Lançamentos de Transferência'));
          if (lancBtn) lancBtn.click();

          setTimeout(() => {
            const novoBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Novo Lançamento'));
            if (novoBtn) novoBtn.click();
          }, 400);
        })()
      `,
    });

    await wait(1200);

    // Simula a bipagem de 1 item com preço (MB-0011-01) e 1 item sem preço (MB-0001-01)
    console.log('Bipando item precificado e item sem preço para demonstrar conferência...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const barcodeInput = document.querySelector('input[placeholder*="Aponte o leitor USB"]');
          if (!barcodeInput) return false;

          // Bipar item 1 com preço: MB-0011-01 (R$ 79.90)
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(barcodeInput, 'MB-0011-01');
          barcodeInput.dispatchEvent(new Event('input', { bubbles: true }));

          const submitBtn = barcodeInput.form ? barcodeInput.form.querySelector('button[type="submit"]') : null;
          if (submitBtn) submitBtn.click();
          return true;
        })()
      `,
    });

    await wait(600);

    // Bipar item 2 sem preço cadastrado: MB-0011-04
    await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const barcodeInput = document.querySelector('input[placeholder*="Aponte o leitor USB"]');
          if (!barcodeInput) return false;

          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(barcodeInput, 'MB-0011-04');
          barcodeInput.dispatchEvent(new Event('input', { bubbles: true }));

          const submitBtn = barcodeInput.form ? barcodeInput.form.querySelector('button[type="submit"]') : null;
          if (submitBtn) submitBtn.click();
          return true;
        })()
      `,
    });

    await wait(800);

    const shotModalBipado = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const modalBipadoPath = path.join(screenshotsDir, 'acerto_lojas_painel_bipado.png');
    fs.writeFileSync(modalBipadoPath, Buffer.from(shotModalBipado.data, 'base64'));
    console.log('✓ Screenshot Modal com Itens Bipados salvo em:', modalBipadoPath);

    cdp.close();

    // Copia todas as imagens para o diretório de artefatos
    const artifactDir = 'C:\\Users\\Pichau\\.gemini\\antigravity\\brain\\fca3eba7-24bf-443a-9cc5-13c492a08a19';
    fs.copyFileSync(mainPath, path.join(artifactDir, 'acerto_lojas_dashboard.png'));
    fs.copyFileSync(pricesPath, path.join(artifactDir, 'acerto_lojas_tabela_precos.png'));
    fs.copyFileSync(modalPricePath, path.join(artifactDir, 'acerto_lojas_modal_editar_preco.png'));
    fs.copyFileSync(modalBipadoPath, path.join(artifactDir, 'acerto_lojas_painel_bipado.png'));
    console.log('✓ Todas as imagens copiadas com sucesso para o diretório de artefatos.');
  } finally {
    chromeProcess.kill();
  }
}

capture().catch((err) => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
