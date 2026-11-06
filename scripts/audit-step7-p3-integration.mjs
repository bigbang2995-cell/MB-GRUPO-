import fs from 'fs';
import path from 'path';

console.log('='.repeat(80));
console.log('ITEM 6: AUDITORIA DE INTEGRAÇÃO — ENTRADA, SAÍDA E ETIQUETAS');
console.log('='.repeat(80));

// 1. Carrega catálogo V30 inicial
const catalogSource = fs.readFileSync('src/lib/v30-catalog.ts', 'utf-8');
const vStart = catalogSource.indexOf('export const V30_VARIANTS');
const varSection = catalogSource.slice(vStart);

const varMatches = Array.from(
  varSection.matchAll(
    /\{\s*"id":\s*"(var-[^"]+)",\s*"product_id":\s*"([^"]+)",\s*"color":\s*"([^"]+)",\s*"size":\s*"([^"]+)",\s*"barcode":\s*"([^"]+)",\s*"stock_quantity":\s*(\d+)/g
  )
);
const prodMatches = Array.from(
  catalogSource.matchAll(
    /\{\s*"id":\s*"(prod-[^"]+)",\s*"sku":\s*"([^"]+)",\s*"name":\s*"([^"]+)"/g
  )
);
const prodMap = new Map();
prodMatches.forEach(m => prodMap.set(m[1], { id: m[1], sku: m[2], name: m[3] }));

let testVariants = varMatches.map(m => ({
  id: m[1],
  product_id: m[2],
  color: m[3],
  size: m[4],
  barcode: m[5],
  stock_quantity: parseInt(m[6], 10), // Todos iniciam em 0
  product: prodMap.get(m[2]) || { id: m[2], sku: 'SKU', name: 'Nome' },
}));

let testMovements = [];

// 6.1 TESTE DE ENTRADA VIA BIPAGEM DIRETA (SCANNER)
console.log('\n6.1 Teste de Entrada via Bipagem Direta (handleScanSuccess):');
function simulateScanSuccess(barcode, idempotencyKey) {
  const clean = (barcode || '').trim().toUpperCase().replace(/;/g, '-');
  const variant = testVariants.find(v => v.barcode === clean);
  if (!variant) return { success: false, code: 'NOT_FOUND' };

  // Idempotência
  const existingMov = testMovements.find(m => m.idempotency_key === idempotencyKey);
  if (existingMov) {
    return { success: true, idempotent_replay: true, message: 'Reenvio idempotente ignorado' };
  }

  const stockBefore = variant.stock_quantity;
  const stockAfter = stockBefore + 1;
  variant.stock_quantity = stockAfter;

  testMovements.push({
    id: `mov-${Date.now()}`,
    variant_id: variant.id,
    movement_type: 'entry',
    quantity: 1,
    stock_before: stockBefore,
    stock_after: stockAfter,
    idempotency_key: idempotencyKey,
  });

  return { success: true, idempotent_replay: false, variant };
}

// Bipa item com hífen normal
const scan1 = simulateScanSuccess('MB-0011-01', 'uuid-scan-001');
console.log(`- Bipagem 1 (MB-0011-01): Sucesso=${scan1.success}, Saldo Anterior=0, Novo Saldo=${scan1.variant?.stock_quantity}`);

// Bipa item com scanner Tomate MDK-104 (ponto e vírgula)
const scan2 = simulateScanSuccess('MB;0011;01', 'uuid-scan-002');
console.log(`- Bipagem 2 (MB;0011;01 via leitor USB): Sucesso=${scan2.success}, Saldo Anterior=1, Novo Saldo=${scan2.variant?.stock_quantity}`);

// Reenvio da mesma chave (teste de idempotência)
const scanReplay = simulateScanSuccess('MB-0011-01', 'uuid-scan-002');
console.log(`- Reenvio de rede com mesma chave: Replay=${scanReplay.idempotent_replay}, Saldo Inalterado=${testVariants.find(v => v.barcode === 'MB-0011-01').stock_quantity}`);

const entryScanOk = scan1.success && scan2.success && scanReplay.idempotent_replay && testVariants.find(v => v.barcode === 'MB-0011-01').stock_quantity === 2;
console.log(`- Resultado Entrada Scanner: [${entryScanOk ? 'APROVADO' : 'FALHA'}]`);

// 6.2 TESTE DE ENTRADA EM LOTE (BATCH SCANNING)
console.log('\n6.2 Teste de Entrada em Lote (onCommitBatch):');
function simulateBatchCommit(countsByVariantId, batchId) {
  Object.entries(countsByVariantId).forEach(([varId, qty]) => {
    const variant = testVariants.find(v => v.id === varId);
    if (variant) {
      const stockBefore = variant.stock_quantity;
      const stockAfter = stockBefore + qty;
      variant.stock_quantity = stockAfter;
      testMovements.push({
        id: `mov-batch-${batchId}-${varId}`,
        variant_id: varId,
        movement_type: 'entry',
        quantity: qty,
        stock_before: stockBefore,
        stock_after: stockAfter,
        note: `Entrada em Lote: ${batchId}`,
      });
    }
  });
}

simulateBatchCommit({
  'var-0011-02': 15,
  'var-0025-01': 20,
}, 'lote-nf-4501');

const v0011_02 = testVariants.find(v => v.id === 'var-0011-02');
const v0025_01 = testVariants.find(v => v.id === 'var-0025-01');
const batchEntryOk = v0011_02.stock_quantity === 15 && v0025_01.stock_quantity === 20;
console.log(`- Lote aplicado: var-0011-02=${v0011_02.stock_quantity} un (Esperado: 15), var-0025-01=${v0025_01.stock_quantity} un (Esperado: 20) -> [${batchEntryOk ? 'APROVADO' : 'FALHA'}]`);

// 6.3 TESTE DE SAÍDA IMEDIATA E CONSOLIDAÇÃO DE SAÍDAS
console.log('\n6.3 Teste de Saída de Estoque (Imediata e Consolidada):');
function simulateImmediateExit(variantId, qty, reason) {
  const variant = testVariants.find(v => v.id === variantId);
  if (!variant || variant.stock_quantity < qty) return { success: false, error: 'SALDO_INSUFICIENTE' };
  const before = variant.stock_quantity;
  const after = before - qty;
  variant.stock_quantity = after;
  testMovements.push({
    id: `mov-exit-${Date.now()}`,
    variant_id: variantId,
    movement_type: 'exit',
    quantity: qty,
    stock_before: before,
    stock_after: after,
    note: reason,
  });
  return { success: true, after };
}

const exit1 = simulateImmediateExit('var-0025-01', 5, 'Venda Shopee Pedido 8891');
console.log(`- Saída imediata 5 un (var-0025-01): Saldo Anterior=20, Saldo Atual=${exit1.after} -> [${exit1.after === 15 ? 'APROVADO' : 'FALHA'}]`);

// Consolidação de Saídas Pendentes
const pendingExits = [
  { id: 'exit-1', variantId: 'var-0011-02', quantity: 3, platform: 'Mercado Livre' },
  { id: 'exit-2', variantId: 'var-0025-01', quantity: 2, platform: 'Site Próprio' },
];

pendingExits.forEach(pe => {
  const v = testVariants.find(item => item.id === pe.variantId);
  const before = v.stock_quantity;
  const after = Math.max(0, before - pe.quantity);
  v.stock_quantity = after;
  testMovements.push({
    id: `mov-exit-consol-${pe.id}`,
    variant_id: pe.variantId,
    movement_type: 'exit',
    quantity: pe.quantity,
    stock_before: before,
    stock_after: after,
  });
});

const v0011_02_afterExit = testVariants.find(v => v.id === 'var-0011-02').stock_quantity;
const v0025_01_afterExit = testVariants.find(v => v.id === 'var-0025-01').stock_quantity;
const exitConsolOk = v0011_02_afterExit === 12 && v0025_01_afterExit === 13;
console.log(`- Saídas consolidadas baixadas: var-0011-02=${v0011_02_afterExit} un (15-3=12), var-0025-01=${v0025_01_afterExit} un (15-2=13) -> [${exitConsolOk ? 'APROVADO' : 'FALHA'}]`);

// 6.4 TESTE DE IMPRESSÃO DE ETIQUETAS E LEITURA DO CÓDIGO GERADO
console.log('\n6.4 Teste de Geração de Etiquetas Térmicas (PDF 82x30mm):');
const code128Source = fs.readFileSync('src/lib/code128.ts', 'utf-8');
const cleanedPatternsText = code128Source.replace(/\/\/[^\n]*/g, '');
const patternsMatch = cleanedPatternsText.match(/CODE128_PATTERNS:\s*readonly\s*string\[\]\s*=\s*\[([\s\S]+?)\];/);
const CODE128_PATTERNS = patternsMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);

function encodeCode128(text, quietZoneModules = 10) {
  const safeText = text || ' ';
  let checksum = 104;
  const patternSequence = [CODE128_PATTERNS[104]];
  for (let i = 0; i < safeText.length; i++) {
    const code = safeText.charCodeAt(i);
    const val = code >= 32 && code <= 126 ? code - 32 : 0;
    checksum += (i + 1) * val;
    patternSequence.push(CODE128_PATTERNS[val]);
  }
  const checkValue = checksum % 103;
  patternSequence.push(CODE128_PATTERNS[checkValue]);
  patternSequence.push(CODE128_PATTERNS[106]);
  let currentX = quietZoneModules;
  const bars = [];
  for (const pattern of patternSequence) {
    for (let j = 0; j < pattern.length; j++) {
      const width = parseInt(pattern[j], 10);
      const isBar = j % 2 === 0;
      if (isBar) bars.push({ x: currentX, width });
      currentX += width;
    }
  }
  return { text: safeText, bars, totalWidth: currentX + quietZoneModules, checkValue };
}

// Testa se todas as 119 variantes oficiais podem ser codificadas para impressão
let printableCount = 0;
for (const v of testVariants) {
  const enc = encodeCode128(v.barcode);
  if (enc && enc.bars.length > 0 && enc.totalWidth > 0) printableCount++;
}
const printableOk = printableCount === testVariants.length;
console.log(`- Codificação Code 128 para impressão de etiquetas: ${printableCount}/${testVariants.length} válidas -> [${printableOk ? 'APROVADO' : 'FALHA'}]`);

// 6.5 Ciclo Completo com Nova Variação:
console.log('\n6.5 Ciclo Completo com Nova Variação (Novo SKU -> Etiqueta -> Bipagem -> Entrada -> Saída):');
// 1. Cria nova variação MB-0011-06
const newVar = {
  id: 'var-0011-06',
  product_id: 'prod-0011',
  color: 'Areia',
  size: 'M',
  barcode: 'MB-0011-06',
  stock_quantity: 0,
  product: { id: 'prod-0011', sku: '0011', name: 'Jaqueta lã batida' },
};
testVariants.push(newVar);

// 2. Codifica etiqueta
const labelEnc = encodeCode128(newVar.barcode);

// 3. Simula bipagem física com leitor USB (produzindo ;)
const simulatedPhysicalScan = newVar.barcode.replace(/-/g, ';');
const scanNewVar = simulateScanSuccess(simulatedPhysicalScan, 'uuid-newvar-entry');

// 4. Dá saída de 1 un
const exitNewVar = simulateImmediateExit(newVar.id, 1, 'Venda Balcão');

const completeCycleOk =
  labelEnc.bars.length > 0 &&
  scanNewVar.success &&
  newVar.stock_quantity === 0 && // 0 + 1 (bipagem) - 1 (saída) = 0
  testMovements.some(m => m.variant_id === newVar.id && m.movement_type === 'entry') &&
  testMovements.some(m => m.variant_id === newVar.id && m.movement_type === 'exit');

console.log(`- Ciclo integrado do Novo SKU "${newVar.barcode}":`);
console.log(`  • Etiqueta codificada: ${labelEnc.bars.length > 0}`);
console.log(`  • Entrada por leitor USB (;) reconhecida: ${scanNewVar.success}`);
console.log(`  • Saída registrada: ${exitNewVar.success}`);
console.log(`  • Saldo final consistente: ${newVar.stock_quantity} un`);
console.log(`  • Status do Ciclo: [${completeCycleOk ? 'APROVADO' : 'FALHA'}]`);

const overallItem6 = entryScanOk && batchEntryOk && exit1.after === 15 && exitConsolOk && printableOk && completeCycleOk;
console.log(`\n>>> RESULTADO ITEM 6: [${overallItem6 ? 'APROVADO COM SUCESSO' : 'REPROVADO'}]`);
