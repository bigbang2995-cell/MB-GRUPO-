import fs from 'fs';

const text = fs.readFileSync('src/lib/v30-catalog.ts', 'utf-8');

// Regex para produtos
const prodMatches = Array.from(text.matchAll(/"id":\s*"(prod-[^"]+)",\s*"sku":\s*"([^"]+)",\s*"name":\s*"([^"]+)"/g));
const prods = prodMatches.map(m => ({ id: m[1], sku: m[2], name: m[3] }));

console.log('=== PADRÃO DE PRODUTOS PAI V30 ===');
console.log('Total de produtos pai:', prods.length);
prods.forEach(p => {
  console.log(`ID: ${p.id.padEnd(14)} | SKU: ${p.sku.padEnd(10)} | Nome: ${p.name}`);
});

// Regex para variações
const varMatches = Array.from(text.matchAll(/"id":\s*"(var-[^"]+)",\s*"product_id":\s*"([^"]+)",\s*"color":\s*"([^"]+)",\s*"size":\s*"([^"]+)",\s*"barcode":\s*"([^"]+)"/g));
const vars = varMatches.map(m => ({
  id: m[1],
  product_id: m[2],
  color: m[3],
  size: m[4],
  barcode: m[5]
}));

console.log('\n=== PADRÃO DE VARIAÇÕES E CÓDIGOS DE BARRAS V30 ===');
console.log('Total de variações:', vars.length);
vars.slice(0, 25).forEach(v => {
  console.log(`ID: ${v.id.padEnd(16)} | ProdID: ${v.product_id.padEnd(12)} | Barcode: ${v.barcode.padEnd(16)} | Cor: ${v.color.padEnd(12)} | Tam: ${v.size}`);
});

// Análise estatística de prefixos e formatos de SKU e Barcode
const skuPatterns = new Set();
prods.forEach(p => {
  if (/^\d{4,5}$/.test(p.sku)) skuPatterns.add('Numérico de 4 ou 5 dígitos (ex: 0011, 12345)');
  else if (/^[A-Za-z]+-\d+$/.test(p.sku)) skuPatterns.add('Prefixo texto + número (ex: cj-889, vl-012)');
  else skuPatterns.add(`Outro: ${p.sku}`);
});

console.log('\nFormatos de SKU de Produto identificados:', Array.from(skuPatterns));

const barcodeStructures = new Set();
vars.forEach(v => {
  const parts = v.barcode.split('-');
  barcodeStructures.add(`Partes: ${parts.length} | Prefixo: ${parts[0]} | Exemplo: ${v.barcode}`);
});
console.log('\nEstruturas de Código de Barras (Barcode):', Array.from(barcodeStructures));

