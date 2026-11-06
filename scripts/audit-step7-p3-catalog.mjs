import fs from 'fs';
import path from 'path';

console.log('='.repeat(80));
console.log('ITEM 1: AUDITORIA DE PRESERVAÇÃO DOS 18 PRODUTOS E 119 VARIAÇÕES V30');
console.log('='.repeat(80));

// 1. Carrega backup original do banco
const backupPath = path.resolve('data/importação/estoque-digital-backup-2026-10-28.json');
const rawBackup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
const backupProducts = rawBackup.data.products || [];

console.log(`Backup original: ${backupProducts.length} produtos carregados.`);

// 2. Carrega v30-catalog.ts
const catalogPath = path.resolve('src/lib/v30-catalog.ts');
const catalogContent = fs.readFileSync(catalogPath, 'utf-8');

const pStart = catalogContent.indexOf('export const V30_PRODUCTS');
const vStart = catalogContent.indexOf('export const V30_VARIANTS');

const prodSection = catalogContent.slice(pStart, vStart);
const varSection = catalogContent.slice(vStart);

// Extrai V30_PRODUCTS da seção específica
const productRegex = /\{\s*"id":\s*"(prod-[^"]+)",\s*"sku":\s*"([^"]+)",\s*"name":\s*"([^"]+)",\s*"image_path":\s*("([^"]+)"|null),\s*"active":\s*(true|false)/g;
const catalogProducts = [];
let pMatch;
while ((pMatch = productRegex.exec(prodSection)) !== null) {
  catalogProducts.push({
    id: pMatch[1],
    sku: pMatch[2],
    name: pMatch[3],
    image_path: pMatch[5] || null,
    active: pMatch[6] === 'true',
  });
}

// Extrai V30_VARIANTS
const variantRegex = /\{\s*"id":\s*"(var-[^"]+)",\s*"product_id":\s*"([^"]+)",\s*"color":\s*"([^"]+)",\s*"size":\s*"([^"]+)",\s*"barcode":\s*"([^"]+)",\s*"stock_quantity":\s*(\d+)/g;
const catalogVariants = [];
let vMatch;
while ((vMatch = variantRegex.exec(varSection)) !== null) {
  catalogVariants.push({
    id: vMatch[1],
    product_id: vMatch[2],
    color: vMatch[3],
    size: vMatch[4],
    barcode: vMatch[5],
    stock_quantity: parseInt(vMatch[6], 10),
  });
}

console.log(`Catálogo V30 parseado: ${catalogProducts.length} produtos em V30_PRODUCTS e ${catalogVariants.length} variantes em V30_VARIANTS.`);

// Verificação 1.1: Quantidade de produtos
const countProductsOk = catalogProducts.length === 18;
console.log(`\n1.1 Quantidade exata de produtos: ${catalogProducts.length} (Esperado: 18) -> [${countProductsOk ? 'APROVADO' : 'FALHA'}]`);

// Verificação 1.2: Quantidade de variantes
const countVariantsOk = catalogVariants.length === 119;
console.log(`1.2 Quantidade exata de variantes: ${catalogVariants.length} (Esperado: 119) -> [${countVariantsOk ? 'APROVADO' : 'FALHA'}]`);

// Verificação 1.3: Unicidade dos IDs de produtos
const productIds = new Set(catalogProducts.map(p => p.id));
const uniqueProdIdsOk = productIds.size === catalogProducts.length;
console.log(`1.3 Unicidade de IDs de produtos: ${productIds.size}/${catalogProducts.length} -> [${uniqueProdIdsOk ? 'APROVADO' : 'FALHA'}]`);

// Verificação 1.4: Unicidade dos SKUs de produtos
const productSkus = new Set(catalogProducts.map(p => p.sku.toUpperCase()));
const uniqueProdSkusOk = productSkus.size === catalogProducts.length;
console.log(`1.4 Unicidade de SKUs de produtos: ${productSkus.size}/${catalogProducts.length} -> [${uniqueProdSkusOk ? 'APROVADO' : 'FALHA'}]`);

// Verificação 1.5: Unicidade dos IDs de variantes
const variantIds = new Set(catalogVariants.map(v => v.id));
const uniqueVarIdsOk = variantIds.size === catalogVariants.length;
console.log(`1.5 Unicidade de IDs de variantes: ${variantIds.size}/${catalogVariants.length} -> [${uniqueVarIdsOk ? 'APROVADO' : 'FALHA'}]`);

// Verificação 1.6: Unicidade dos Barcodes de variantes
const barcodes = new Set(catalogVariants.map(v => v.barcode.toUpperCase()));
const uniqueBarcodesOk = barcodes.size === catalogVariants.length;
console.log(`1.6 Unicidade de Barcodes de variantes: ${barcodes.size}/${catalogVariants.length} -> [${uniqueBarcodesOk ? 'APROVADO' : 'FALHA'}]`);

// Verificação 1.7: Saldos zerados em todas as 119 variantes
const nonZeroVariants = catalogVariants.filter(v => v.stock_quantity !== 0);
const allZeroStockOk = nonZeroVariants.length === 0;
console.log(`1.7 Integridade de saldos zerados: ${catalogVariants.length - nonZeroVariants.length}/119 zerados -> [${allZeroStockOk ? 'APROVADO' : 'FALHA'}]`);
if (!allZeroStockOk) {
  console.log('   Variantes com saldo não-zero:', nonZeroVariants);
}

// Verificação 1.8: Integridade referencial variant.product_id -> product.id
const missingProductRefs = catalogVariants.filter(v => !productIds.has(v.product_id));
const referentialIntegrityOk = missingProductRefs.length === 0;
console.log(`1.8 Integridade referencial (variant -> product): ${catalogVariants.length - missingProductRefs.length}/119 válidas -> [${referentialIntegrityOk ? 'APROVADO' : 'FALHA'}]`);

// Verificação 1.9: Existência de imagens físicas em public/
let existingImages = 0;
let missingImages = [];
for (const p of catalogProducts) {
  if (p.image_path) {
    const fullPath = path.join('public', p.image_path);
    if (fs.existsSync(fullPath)) {
      existingImages++;
    } else {
      missingImages.push({ sku: p.sku, path: p.image_path });
    }
  }
}
const imagesOk = missingImages.length === 0;
console.log(`1.9 Existência das imagens dos produtos no disco: ${existingImages}/${catalogProducts.length} encontradas -> [${imagesOk ? 'APROVADO' : 'FALHA'}]`);
if (!imagesOk) {
  console.log('   Imagens ausentes:', missingImages);
}

// Verificação 1.10: Comparação de integridade com o backup
let matchingBackupProds = 0;
for (const p of catalogProducts) {
  const match = backupProducts.find(bp => bp.sku.trim().toLowerCase() === p.sku.trim().toLowerCase());
  if (match) matchingBackupProds++;
}
console.log(`1.10 Correlação de SKUs com backup original: ${matchingBackupProds}/18 produtos correspondem ao backup -> [${matchingBackupProds === 18 ? 'APROVADO' : 'FALHA'}]`);

// Listagem completa dos 18 produtos
console.log('\n--- TABELA DOS 18 PRODUTOS OFICIAIS V30 ---');
catalogProducts.forEach((p, idx) => {
  const vars = catalogVariants.filter(v => v.product_id === p.id);
  console.log(`${String(idx + 1).padStart(2, ' ')}. SKU: ${p.sku.padEnd(10, ' ')} | ID: ${p.id.padEnd(14, ' ')} | Variações: ${String(vars.length).padStart(2, ' ')} un | Nome: ${p.name}`);
});

const overallItem1 = countProductsOk && countVariantsOk && uniqueProdIdsOk && uniqueProdSkusOk && uniqueVarIdsOk && uniqueBarcodesOk && allZeroStockOk && referentialIntegrityOk && imagesOk && matchingBackupProds === 18;
console.log(`\n>>> RESULTADO ITEM 1: [${overallItem1 ? 'APROVADO COM SUCESSO' : 'REPROVADO'}]`);
