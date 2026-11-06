import fs from 'fs';

console.log('=== TESTES DE ENTRADA DO SCANNER NO CATÁLOGO V30 ===\n');

// Lê o arquivo v30-catalog.ts como texto e extrai os códigos de barras
const catalogContent = fs.readFileSync('src/lib/v30-catalog.ts', 'utf-8');

// Regex para capturar todos os barcodes do catálogo
const barcodeMatches = Array.from(catalogContent.matchAll(/"barcode":\s*"([^"]+)"/g)).map(m => m[1]);

console.log(`Total de códigos de barras no catálogo V30: ${barcodeMatches.length}`);

const codeNormal = 'MB-0025-01';
const codeSemicolon = 'MB;0025;01';

console.log(`\n1. Teste com entrada exata: "${codeNormal}"`);
const foundNormal = barcodeMatches.includes(codeNormal);
console.log(`- Encontrado diretamente no catálogo: ${foundNormal ? 'SIM (SUCESSO)' : 'NÃO'}`);

console.log(`\n2. Teste com entrada do scanner MDK-104: "${codeSemicolon}"`);
const foundSemicolon = barcodeMatches.includes(codeSemicolon);
console.log(`- Encontrado diretamente no catálogo: ${foundSemicolon ? 'SIM' : 'NÃO (FALHA: NOT_FOUND)'}`);

console.log(`\n3. Teste de Normalização Inteligente (substituição de ponto e vírgula):`);
// Normalização: substitui ';' por '-' quando segue o padrão MB;XXXX;YY
const normalizedCode = codeSemicolon.replace(/;/g, '-');
const foundNormalized = barcodeMatches.includes(normalizedCode);
console.log(`- Código após normalização: "${normalizedCode}"`);
console.log(`- Encontrado após normalização: ${foundNormalized ? 'SIM (SUCESSO 100%)' : 'NÃO'}`);

// Teste em lote com outros SKUs que possam sofrer o mesmo desvio de teclado
const testCases = [
  'MB;0011;01',
  'MB;0025;02',
  'MB;0025;03',
  'MB;CJ;889;01',
  'mb;0025;01',
  ' MB;0025;01 ',
];

console.log(`\n4. Simulação em lote com códigos afetados pelo layout de teclado:`);
testCases.forEach(input => {
  const norm = input.trim().toUpperCase().replace(/;/g, '-');
  const matched = barcodeMatches.includes(norm);
  console.log(`- Entrada: "${input}" -> Normalizado: "${norm}" -> Match Catálogo: ${matched ? '✓' : '✗'}`);
});

