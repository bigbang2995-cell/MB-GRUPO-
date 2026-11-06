import fs from 'fs';
import path from 'path';

console.log('='.repeat(80));
console.log('ITEM 5: AUDITORIA DE COMPATIBILIDADE DE SCANNERS E NORMALIZAÇÃO ; -> -');
console.log('='.repeat(80));

// Carrega variantes do catálogo V30
const catalogSource = fs.readFileSync('src/lib/v30-catalog.ts', 'utf-8');
const prodMatches = Array.from(
  catalogSource.matchAll(
    /\{\s*"id":\s*"(prod-[^"]+)",\s*"sku":\s*"([^"]+)",\s*"name":\s*"([^"]+)"/g
  )
);
const prodMap = new Map();
prodMatches.forEach(m => prodMap.set(m[1], { id: m[1], sku: m[2], name: m[3] }));

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
  product: prodMap.get(m[2]) || { id: m[2], sku: 'SKU', name: 'Nome' },
}));

function resolveScannedBarcode(rawInput, variants) {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      success: false,
      rawInput: rawInput || '',
      wasNormalized: false,
      error: 'EMPTY_CODE',
      errorMessage: 'Código de barras não informado.',
    };
  }

  const cleanInput = rawInput.trim();
  if (cleanInput.length === 0) {
    return {
      success: false,
      rawInput,
      wasNormalized: false,
      error: 'EMPTY_CODE',
      errorMessage: 'Código de barras vazio.',
    };
  }

  // PASS 1: Correspondência Exata
  const exactMatches = variants.filter(
    (v) => (v.barcode && v.barcode === cleanInput) || v.id === cleanInput
  );

  if (exactMatches.length === 1) {
    return {
      success: true,
      matchedVariant: exactMatches[0],
      rawInput,
      normalizedCode: exactMatches[0].barcode || exactMatches[0].id,
      matchType: 'exact',
      wasNormalized: false,
    };
  }

  if (exactMatches.length > 1) {
    return {
      success: false,
      rawInput,
      wasNormalized: false,
      error: 'AMBIGUOUS_MATCH',
      errorMessage: `Ambiguidade detectada: existem ${exactMatches.length} itens cadastrados com este código exato.`,
    };
  }

  // PASS 2: Case-insensitive
  const lowerInput = cleanInput.toLowerCase();
  const caseMatches = variants.filter(
    (v) =>
      (v.barcode && v.barcode.toLowerCase() === lowerInput) ||
      v.id.toLowerCase() === lowerInput
  );

  if (caseMatches.length === 1) {
    return {
      success: true,
      matchedVariant: caseMatches[0],
      rawInput,
      normalizedCode: caseMatches[0].barcode || caseMatches[0].id,
      matchType: 'case_insensitive',
      wasNormalized: false,
    };
  }

  if (caseMatches.length > 1) {
    return {
      success: false,
      rawInput,
      wasNormalized: false,
      error: 'AMBIGUOUS_MATCH',
      errorMessage: `Ambiguidade detectada: existem ${caseMatches.length} itens com variações de maiúsculas/minúsculas.`,
    };
  }

  // PASS 3: Normalização de ponto e vírgula (Tomate MDK-104 / Teclado ABNT2)
  if (cleanInput.includes(';')) {
    const candidateHyphen = cleanInput.replace(/;/g, '-');
    const candidateLower = candidateHyphen.toLowerCase();

    let hyphenMatches = variants.filter(
      (v) =>
        (v.barcode && v.barcode === candidateHyphen) ||
        v.id === candidateHyphen
    );

    if (hyphenMatches.length === 0) {
      hyphenMatches = variants.filter(
        (v) =>
          (v.barcode && v.barcode.toLowerCase() === candidateLower) ||
          v.id.toLowerCase() === candidateLower
      );
    }

    if (hyphenMatches.length === 1) {
      return {
        success: true,
        matchedVariant: hyphenMatches[0],
        rawInput,
        normalizedCode: hyphenMatches[0].barcode || hyphenMatches[0].id,
        matchType: 'normalized_semicolon',
        wasNormalized: true,
      };
    }

    if (hyphenMatches.length > 1) {
      return {
        success: false,
        rawInput,
        wasNormalized: true,
        error: 'AMBIGUOUS_MATCH',
        errorMessage: `Ambiguidade na normalização de ponto e vírgula: ${hyphenMatches.length} itens encontrados para "${candidateHyphen}".`,
      };
    }
  }

  return {
    success: false,
    rawInput,
    wasNormalized: false,
    error: 'NOT_FOUND',
    errorMessage: `Código de barras não cadastrado: "${cleanInput}".`,
  };
}

// 5.1 Teste dos 119 Códigos com Hífen Normal
console.log('\n5.1 Leitura Padrão com Hífen (-) para todos os 119 itens:');
let exactMatchesCount = 0;
for (const v of v30Variants) {
  const res = resolveScannedBarcode(v.barcode, v30Variants);
  if (res.success && res.matchType === 'exact' && !res.wasNormalized && res.matchedVariant.id === v.id) {
    exactMatchesCount++;
  }
}
const exactOk = exactMatchesCount === 119;
console.log(`- Barcodes padrão com hífen: ${exactMatchesCount}/119 validados -> [${exactOk ? 'APROVADO' : 'FALHA'}]`);

// 5.2 Teste dos 119 Códigos com Ponto e Vírgula (Scanner Tomate MDK-104)
console.log('\n5.2 Leitura com Ponto e Vírgula (;) do Scanner Tomate MDK-104 em ABNT2:');
let semicolonMatchesCount = 0;
for (const v of v30Variants) {
  const semicolonInput = v.barcode.replace(/-/g, ';');
  const res = resolveScannedBarcode(semicolonInput, v30Variants);
  if (res.success && res.matchType === 'normalized_semicolon' && res.wasNormalized && res.matchedVariant.id === v.id) {
    semicolonMatchesCount++;
  }
}
const semicolonOk = semicolonMatchesCount === 119;
console.log(`- Barcodes com ';' normalizados para '-': ${semicolonMatchesCount}/119 validados -> [${semicolonOk ? 'APROVADO' : 'FALHA'}]`);

// 5.3 SKUs com múltiplos hifens (ex: MB-CJ-889-01 -> MB;CJ;889;01)
console.log('\n5.3 Teste de SKUs com múltiplos hífens (ex: CJ-889, CJ-866):');
const multiHyphens = v30Variants.filter(v => v.barcode.split('-').length > 3);
console.log(`- Encontradas ${multiHyphens.length} variações com múltiplos hífens no Catálogo V30.`);
let multiHyphenPass = 0;
for (const v of multiHyphens) {
  const rawScanner = v.barcode.replace(/-/g, ';');
  const res = resolveScannedBarcode(rawScanner, v30Variants);
  if (res.success && res.normalizedCode === v.barcode) {
    multiHyphenPass++;
  }
}
const multiHyphenOk = multiHyphenPass === multiHyphens.length;
console.log(`- Variações com múltiplos hífens normalizadas: ${multiHyphenPass}/${multiHyphens.length} -> [${multiHyphenOk ? 'APROVADO' : 'FALHA'}]`);

// 5.4 Não-mutação de códigos numéricos puros (EAN-13, EAN-8)
console.log('\n5.4 Preservação de Códigos Numéricos Puros (Sem Mutação):');
const eanList = [
  { id: 'var-ean-1', barcode: '7891000100028', color: 'Azul', size: 'M' },
  { id: 'var-ean-2', barcode: '7895000100010', color: 'Preto', size: 'G' },
];
const combinedCatalog = [...v30Variants, ...eanList];
let eanPass = 0;
for (const ean of eanList) {
  const res = resolveScannedBarcode(ean.barcode, combinedCatalog);
  if (res.success && res.matchType === 'exact' && !res.wasNormalized && res.normalizedCode === ean.barcode) {
    eanPass++;
  }
}
const eanOk = eanPass === eanList.length;
console.log(`- Códigos numéricos EAN-13 lidos sem mutação: ${eanPass}/${eanList.length} -> [${eanOk ? 'APROVADO' : 'FALHA'}]`);

// 5.5 Tolerância a caracteres de controle e ruídos de teclado USB
console.log('\n5.5 Tolerância a Ruídos de Entrada (Espaços, Quebras de Linha, Minúsculas):');
const noisyInputs = [
  { raw: '  MB;0011;01  ', expected: 'MB-0011-01', desc: 'Espaços no início e fim' },
  { raw: 'mb;0011;01\r\n', expected: 'MB-0011-01', desc: 'Minúsculas com CR/LF do scanner USB' },
  { raw: '\tMB;CJ;889;01\n', expected: 'MB-CJ-889-01', desc: 'Tabulação e quebra de linha' },
];
let noisePass = 0;
for (const item of noisyInputs) {
  const res = resolveScannedBarcode(item.raw, v30Variants);
  const ok = res.success && res.normalizedCode === item.expected;
  console.log(`- "${item.desc}": "${item.raw.trim()}" -> "${res.normalizedCode}" [${ok ? 'OK' : 'FALHA'}]`);
  if (ok) noisePass++;
}
const noiseOk = noisePass === noisyInputs.length;

const overallItem5 = exactOk && semicolonOk && multiHyphenOk && eanOk && noiseOk;
console.log(`\n>>> RESULTADO ITEM 5: [${overallItem5 ? 'APROVADO COM SUCESSO' : 'REPROVADO'}]`);

