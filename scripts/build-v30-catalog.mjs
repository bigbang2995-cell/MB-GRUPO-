import fs from 'fs';
import path from 'path';

const backupPath = 'data/importação/estoque-digital-backup-2026-10-28.json';
const raw = fs.readFileSync(backupPath, 'utf8');
const backup = JSON.parse(raw);
const rawProducts = backup.data.products;

function sanitizeFilename(sku) {
  return sku.replace(/[^a-zA-Z0-9_-]/g, '_');
}

const v30Products = [];
const v30Variants = [];
const barcodeSet = new Set();
let tuCount = 0;
let gradeCount = 0;

rawProducts.forEach((p) => {
  const skuStr = String(p.sku);
  const skuSafe = sanitizeFilename(skuStr);
  const imgPublicUrl = `/images/products/sku-${skuSafe}.jpg`;
  const productId = `prod-${skuSafe}`;

  const productObj = {
    id: productId,
    sku: skuStr,
    name: p.name,
    image_path: imgPublicUrl,
    active: true,
    created_at: backup.exportedAt || '2026-10-28T14:00:10.739Z',
    updated_at: backup.exportedAt || '2026-10-28T14:00:10.739Z',
  };
  v30Products.push(productObj);

  const colors = Object.keys(p.colors || {});
  const hasGrade = Boolean(p.sizesEnabled && p.sizes && p.sizes.length > 0);
  const sizes = hasGrade ? p.sizes : ['TU'];

  if (hasGrade) {
    gradeCount++;
  } else {
    tuCount++;
  }

  let varSequence = 0;
  colors.forEach((color) => {
    sizes.forEach((size) => {
      varSequence++;
      const seqStr = String(varSequence).padStart(2, '0');
      const barcode = `MB-${skuStr.toUpperCase()}-${seqStr}`;
      
      if (barcodeSet.has(barcode)) {
        throw new Error(`Código de barras duplicado detectado: ${barcode}`);
      }
      barcodeSet.add(barcode);

      const variantId = `var-${skuSafe}-${seqStr}`;
      const variantObj = {
        id: variantId,
        product_id: productId,
        color: color,
        size: size,
        barcode: barcode,
        stock_quantity: 0, // REGRA ABSOLUTA: SALDO INICIAL OBRIGATORIAMENTE ZERO
        created_at: backup.exportedAt || '2026-10-28T14:00:10.739Z',
        product: productObj,
      };
      v30Variants.push(variantObj);
    });
  });
});

const tsContent = `// Catálogo Oficial V30 — Estoque Digital MB Grupo
// Importado de data/importação/estoque-digital-backup-2026-10-28.json
// REGRA ABSOLUTA: Todos os 119 saldos de variantes iniciam obrigatoriamente em ZERO (0).
// Fotografias extraídas e armazenadas em /images/products/sku-<sku>.jpg.

import { Product, ProductVariant } from '@/types/database';

export const V30_CATALOG_EXPORTED_AT = ${JSON.stringify(backup.exportedAt || '2026-10-28T14:00:10.739Z')};
export const V30_APP_VERSION = 'V30';

export const V30_PRODUCTS: Product[] = ${JSON.stringify(v30Products, null, 2)};

export const V30_VARIANTS: (ProductVariant & { product: Product })[] = ${JSON.stringify(v30Variants, null, 2)};
`;

fs.writeFileSync('src/lib/v30-catalog.ts', tsContent, 'utf8');

console.log('✅ Arquivo src/lib/v30-catalog.ts gerado com sucesso!');
console.log(`📦 Produtos: ${v30Products.length} (esperado 18)`);
console.log(`🏷️ Variações: ${v30Variants.length} (esperado 119)`);
console.log(`📊 Produtos TU: ${tuCount} (esperado 15)`);
console.log(`📏 Produtos com Grade: ${gradeCount} (esperado 3)`);
console.log(`🔒 Códigos de barras únicos e estáveis: ${barcodeSet.size}`);

