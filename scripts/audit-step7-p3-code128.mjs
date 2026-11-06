import fs from 'fs';
import path from 'path';

console.log('='.repeat(80));
console.log('ITEM 2: AUDITORIA DE GERAÇÃO ÚNICA, ESTÁVEL E SEM RECICLAGEM (CODE 128)');
console.log('='.repeat(80));

// Carrega os 107 padrões Code 128
const code128Source = fs.readFileSync('src/lib/code128.ts', 'utf-8');
const patternsMatch = code128Source.match(/CODE128_PATTERNS:\s*readonly\s*string\[\]\s*=\s*\[([\s\S]+?)\];/);
const CODE128_PATTERNS = patternsMatch[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);

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
  const pathParts = [];

  for (const pattern of patternSequence) {
    for (let j = 0; j < pattern.length; j++) {
      const width = parseInt(pattern[j], 10);
      const isBar = j % 2 === 0;
      if (isBar) {
        bars.push({ x: currentX, width });
        pathParts.push(`M${currentX},0h${width}v100h-${width}z`);
      }
      currentX += width;
    }
  }

  return {
    text: safeText,
    bars,
    totalWidth: currentX + quietZoneModules,
    checkValue,
    svgPath: pathParts.join(''),
  };
}

// Carrega variantes do catálogo V30
const catalogSource = fs.readFileSync('src/lib/v30-catalog.ts', 'utf-8');
const varMatches = Array.from(
  catalogSource.matchAll(
    /\{\s*"id":\s*"(var-[^"]+)",\s*"product_id":\s*"([^"]+)",\s*"color":\s*"([^"]+)",\s*"size":\s*"([^"]+)",\s*"barcode":\s*"([^"]+)",\s*"stock_quantity":\s*(\d+)/g
  )
);
const v30Variants = varMatches.map(m => ({
  id: m[1],
  product_id: m[2],
  color: m[3],
  size: m[4],
  barcode: m[5],
  stock_quantity: parseInt(m[6], 10),
}));

function extractBaseSku(rawSku) {
  let clean = (rawSku || '').trim();
  clean = clean.replace(/^MB-?/i, '');
  return {
    cleanSku: clean,
    upperSku: clean.toUpperCase(),
    lowerSku: clean.toLowerCase(),
  };
}

function generateNextVariantCode(params) {
  const { productSku, productName, color, size, existingVariants } = params;
  const { upperSku, lowerSku } = extractBaseSku(productSku);

  if (!upperSku) {
    throw new Error('SKU Base não pode ser vazio para geração de código de barras.');
  }

  const existingBarcodes = new Set();
  const existingIds = new Set();
  let maxIndex = 0;

  for (const v of existingVariants) {
    if (v.barcode) existingBarcodes.add(v.barcode.toUpperCase());
    if (v.id) existingIds.add(v.id.toLowerCase());

    const barcodeStr = v.barcode || '';
    const prefixExpected = `MB-${upperSku}-`;
    if (barcodeStr.toUpperCase().startsWith(prefixExpected)) {
      const suffix = barcodeStr.slice(prefixExpected.length);
      const parsedNum = parseInt(suffix, 10);
      if (!isNaN(parsedNum) && parsedNum > maxIndex) {
        maxIndex = parsedNum;
      }
    }

    const idExpected = `var-${lowerSku}-`;
    if (v.id.toLowerCase().startsWith(idExpected)) {
      const suffix = v.id.slice(idExpected.length);
      const parsedNum = parseInt(suffix, 10);
      if (!isNaN(parsedNum) && parsedNum > maxIndex) {
        maxIndex = parsedNum;
      }
    }
  }

  let candidateIndex = maxIndex + 1;
  let candidateBarcode = '';
  let candidateId = '';

  while (true) {
    const formattedIndex = String(candidateIndex).padStart(2, '0');
    candidateBarcode = `MB-${upperSku}-${formattedIndex}`;
    candidateId = `var-${lowerSku}-${formattedIndex}`;

    const barcodeCollides = existingBarcodes.has(candidateBarcode.toUpperCase());
    const idCollides = existingIds.has(candidateId.toLowerCase());

    if (!barcodeCollides && !idCollides) {
      break;
    }
    candidateIndex++;
  }

  let code128Valid = true;
  try {
    const encoded = encodeCode128(candidateBarcode);
    code128Valid = Boolean(encoded && encoded.bars.length > 0);
  } catch {
    code128Valid = false;
  }

  return {
    variantId: candidateId,
    barcode: candidateBarcode,
    sku: upperSku,
    productName: productName.trim() || `Produto ${upperSku}`,
    color: color.trim() || 'Padrão',
    size: size.trim() || 'M',
    isUnique: true,
    code128Valid,
  };
}

// 2.1 Teste de estabilidade determinística
console.log('\n2.1 Teste de Estabilidade Determinística:');
const gen1 = generateNextVariantCode({
  productSku: '0011',
  productName: 'Jaqueta lã batida',
  color: 'Rosa',
  size: 'M',
  existingVariants: v30Variants,
});
const gen2 = generateNextVariantCode({
  productSku: '0011',
  productName: 'Jaqueta lã batida',
  color: 'Rosa',
  size: 'M',
  existingVariants: v30Variants,
});
const isDeterministic = gen1.barcode === gen2.barcode && gen1.variantId === gen2.variantId && gen1.barcode === 'MB-0011-06';
console.log(`- Execução 1: ${gen1.barcode} | Execução 2: ${gen2.barcode} -> [${isDeterministic ? 'APROVADO' : 'FALHA'}]`);

// 2.2 Teste de ausência de reciclagem (Gap de exclusão)
console.log('\n2.2 Teste de Ausência de Reciclagem de Códigos (Gaps):');
// Simulamos que existiam MB-0011-01 a MB-0011-08, mas MB-0011-02 e 03 foram deletados do banco (ou seja, só restam 01, 04, 08)
const gappedVariants = [
  { id: 'var-0011-01', barcode: 'MB-0011-01' },
  { id: 'var-0011-04', barcode: 'MB-0011-04' },
  { id: 'var-0011-08', barcode: 'MB-0011-08' },
];
const genGapped = generateNextVariantCode({
  productSku: '0011',
  productName: 'Jaqueta',
  color: 'Cinza',
  size: 'G',
  existingVariants: gappedVariants,
});
// NÃO deve reciclar 02 ou 03. Deve avançar para 09!
const noRecyclingOk = genGapped.barcode === 'MB-0011-09';
console.log(`- Gaps presentes (01, 04, 08). Próximo gerado: ${genGapped.barcode} (Esperado: MB-0011-09) -> [${noRecyclingOk ? 'APROVADO: SEM RECICLAGEM' : 'FALHA: HOUVE RECICLAGEM'}]`);

// 2.3 Teste de colisão cruzada forçada
console.log('\n2.3 Teste de Prevenção de Colisão Cruzada:');
// Simulamos que por acidente alguém já cadastrou MB-0011-06 manualmente em outro item
const collidedVariants = [
  ...v30Variants,
  { id: 'var-custom-99', barcode: 'MB-0011-06' }, // colisão forçada no 06
];
const genAvoidCollision = generateNextVariantCode({
  productSku: '0011',
  productName: 'Jaqueta',
  color: 'Bege Claro',
  size: 'P',
  existingVariants: collidedVariants,
});
// Como 06 colide, deve saltar automaticamente para 07
const avoidCollisionOk = genAvoidCollision.barcode === 'MB-0011-07';
console.log(`- Colisão forçada em MB-0011-06. Código saltou para: ${genAvoidCollision.barcode} -> [${avoidCollisionOk ? 'APROVADO' : 'FALHA'}]`);

// 2.4 Teste de geração em lote de 100 variações sequenciais
console.log('\n2.4 Teste de Geração Contínua em Lote (100 variações consecutivas):');
let simulatedList = [...v30Variants];
const generatedSet = new Set();
let allCode128Valid = true;
let collisionCount = 0;

for (let i = 0; i < 100; i++) {
  const next = generateNextVariantCode({
    productSku: '0011',
    productName: 'Jaqueta lã batida',
    color: `Cor Teste ${i}`,
    size: 'U',
    existingVariants: simulatedList,
  });

  if (generatedSet.has(next.barcode)) {
    collisionCount++;
  }
  generatedSet.add(next.barcode);

  if (!next.code128Valid) {
    allCode128Valid = false;
  }

  // Adiciona à lista em memória
  simulatedList.push({
    id: next.variantId,
    barcode: next.barcode,
  });
}

const batchOk = collisionCount === 0 && generatedSet.size === 100 && allCode128Valid;
console.log(`- 100 códigos gerados: ${generatedSet.size} únicos | Colisões: ${collisionCount} | Code 128 Válidos: ${allCode128Valid ? '100%' : 'FALHA'} -> [${batchOk ? 'APROVADO' : 'FALHA'}]`);
console.log(`  Primeiro gerado: ${Array.from(generatedSet)[0]} | Último gerado: ${Array.from(generatedSet)[99]}`);

// 2.5 Teste com SKUs alfanuméricos e prefixos redundantes
console.log('\n2.5 Teste com SKUs Variados (Alfanuméricos, Prefixos):');
const testCases = [
  { sku: 'MB-0011', expectedPrefix: 'MB-0011-' },
  { sku: 'cj-889', expectedPrefix: 'MB-CJ-889-' },
  { sku: 'vl012', expectedPrefix: 'MB-VL012-' },
  { sku: '89550', expectedPrefix: 'MB-89550-' },
];
let variadosOk = true;
testCases.forEach(tc => {
  const res = generateNextVariantCode({
    productSku: tc.sku,
    productName: 'Produto Teste',
    color: 'Azul',
    size: 'G',
    existingVariants: v30Variants,
  });
  const starts = res.barcode.startsWith(tc.expectedPrefix);
  console.log(`- SKU "${tc.sku}" -> Barcode "${res.barcode}" | ID "${res.variantId}" -> [${starts ? 'OK' : 'FALHA'}]`);
  if (!starts) variadosOk = false;
});

const overallItem2 = isDeterministic && noRecyclingOk && avoidCollisionOk && batchOk && variadosOk;
console.log(`\n>>> RESULTADO ITEM 2: [${overallItem2 ? 'APROVADO COM SUCESSO' : 'REPROVADO'}]`);

