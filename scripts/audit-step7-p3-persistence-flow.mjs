import fs from 'fs';
import path from 'path';

console.log('='.repeat(80));
console.log('ITEM 3 & 4: AUDITORIA DE CADASTRO DE NOVAS VARIAÇÕES E PERSISTÊNCIA F5');
console.log('='.repeat(80));

// Carrega o código do barcode-service
const barcodeSource = fs.readFileSync('src/lib/barcode-service.ts', 'utf-8');
const pageSource = fs.readFileSync('src/app/page.tsx', 'utf-8');
const stockModuleSource = fs.readFileSync('src/components/modules/StockModule.tsx', 'utf-8');

// 3.1 Auditoria do Registro de Nova Variação
console.log('\n3.1 Inspeção do Handler de Cadastro (handleAddVariant):');
const handleAddVariantMatch = pageSource.match(/const handleAddVariant = \(([\s\S]+?)\) => \{([\s\S]+?)\};/);
if (handleAddVariantMatch) {
  const handlerBody = handleAddVariantMatch[2];
  console.log('Corpo de handleAddVariant encontrado em src/app/page.tsx:');
  console.log(handlerBody.trim());
  const hasLocalStorage = handlerBody.includes('localStorage.setItem');
  console.log(`- Contém gravação em localStorage: ${hasLocalStorage ? 'SIM' : 'NÃO (VULNERABILIDADE DETECTADA)'}`);
}

// 3.2 Auditoria do useEffect de Carregamento no F5
console.log('\n3.2 Inspeção da Condição de Restauração no F5 (useEffect em page.tsx):');
const f5ConditionMatch = pageSource.match(/if\s*\(Array\.isArray\(parsed\)\s*&&\s*parsed\.length\s*===?\s*V30_VARIANTS\.length\)/);
if (f5ConditionMatch) {
  console.log(`- Condição restritiva encontrada: "${f5ConditionMatch[0]}"`);
  console.log('  -> PROBLEMA: Bloqueia qualquer catálogo com mais de 119 itens após cadastrar novos SKUs!');
} else {
  console.log('- Condição não encontrada ou modificada.');
}

// 3.3 Auditoria da Consolidação de Saídas (handleConsolidateExits)
console.log('\n3.3 Inspeção da Consolidação de Saídas (handleConsolidateExits):');
const consolidateMatch = pageSource.match(/const handleConsolidateExits = \(\) => \{([\s\S]+?)\n  \};/);
if (consolidateMatch) {
  const body = consolidateMatch[1];
  const hasVariantsStorage = body.includes("localStorage.setItem('MB_GRUPO_STOCK_VARIANTS_V30'");
  const hasMovementsStorage = body.includes("localStorage.setItem('MB_GRUPO_STOCK_MOVEMENTS_V30'");
  console.log(`- Grava variantes em localStorage na consolidação: ${hasVariantsStorage ? 'SIM' : 'NÃO (VULNERABILIDADE DETECTADA)'}`);
  console.log(`- Grava movimentações em localStorage na consolidação: ${hasMovementsStorage ? 'SIM' : 'NÃO (VULNERABILIDADE DETECTADA)'}`);
}

// 3.4 Auditoria da Presença do Botão "Novo SKU" em StockModule
console.log('\n3.4 Auditoria de UI do Módulo de Estoque (StockModule.tsx):');
const stockModuleHasAddButton = stockModuleSource.includes('quickActionModal') || stockModuleSource.includes('Novo SKU') || stockModuleSource.includes('createMemoryVariant');
const stockModuleReceivesHandler = pageSource.includes('<StockModule') && pageSource.match(/<StockModule[\s\S]+?\/>/)[0].includes('onAddVariant');
console.log(`- StockModule possui botão/modal de Novo SKU: ${stockModuleHasAddButton ? 'SIM' : 'NÃO (Apenas Dashboard possui)'}`);
console.log(`- page.tsx passa prop onAddVariant para StockModule: ${stockModuleReceivesHandler ? 'SIM' : 'NÃO (Prop não repassada)'}`);

// 3.5 Simulação em Memória do Ciclo de Vida: Cadastro -> F5 -> Bipagem
console.log('\n3.5 Simulação do Ciclo Completo de Adição e F5:');
const mockLocalStorage = new Map();

// Estado inicial com 119 variantes
const initial119Variants = Array.from({ length: 119 }, (_, i) => ({
  id: `var-test-${i}`,
  barcode: `MB-TEST-${String(i).padStart(2, '0')}`,
  stock_quantity: 0,
}));

// Operação: Cadastro de Nova Variação (item 120)
const newVariant120 = {
  id: 'var-0011-06',
  product_id: 'prod-0011',
  color: 'Verde Militar',
  size: 'G',
  barcode: 'MB-0011-06',
  stock_quantity: 10,
  product: { id: 'prod-0011', sku: '0011', name: 'Jaqueta lã batida', active: true },
};

const updatedVariantsList = [newVariant120, ...initial119Variants]; // 120 itens

// Cenário A: Comportamento Atual do Código em page.tsx
console.log('--- Cenário A: Comportamento Atual de page.tsx ---');
// 1. handleAddVariant atual apenas faz setVariants, NÃO grava no localStorage:
let currentStorageVal = mockLocalStorage.get('MB_GRUPO_STOCK_VARIANTS_V30');
console.log(`- Após handleAddVariant, salvo no localStorage: ${currentStorageVal ? 'Existe' : 'Nenhum dado salvo'}`);

// 2. Se o usuário fizer uma movimentação que salve a lista de 120 itens no localStorage:
mockLocalStorage.set('MB_GRUPO_STOCK_VARIANTS_V30', JSON.stringify(updatedVariantsList));

// 3. O usuário pressiona F5:
const savedAfterF5 = JSON.parse(mockLocalStorage.get('MB_GRUPO_STOCK_VARIANTS_V30'));
const currentF5Check = Array.isArray(savedAfterF5) && savedAfterF5.length === 119;
console.log(`- Teste da condição atual (parsed.length === 119 com 120 itens): ${currentF5Check}`);
console.log(`- Resultado no F5: ${currentF5Check ? 'Variantes restauradas' : 'DESCARTE TOTAL: Novos itens e saldos são perdidos!'}`);

// Cenário B: Comportamento Recomendado (Robusto)
console.log('\n--- Cenário B: Comportamento Recomendado ---');
const recommendedF5Check = Array.isArray(savedAfterF5) && savedAfterF5.length >= 119;
console.log(`- Teste da condição recomendada (parsed.length >= 119): ${recommendedF5Check}`);
console.log(`- Resultado no F5: ${recommendedF5Check ? 'SUCESSO: Todas as 120 variações e seus saldos são restaurados com fidelidade!' : 'FALHA'}`);

// 3.6 Auditoria de Tratamento de Erro de Armazenamento (QuotaExceeded)
console.log('\n3.6 Auditoria de Tratamento de Exceções de Armazenamento:');
const emptyCatches = (pageSource.match(/catch\s*\{\s*\}/g) || []).length;
console.log(`- Quantidade de blocos "catch {}" silenciosos em page.tsx: ${emptyCatches}`);
console.log('- Risco: Erros como QuotaExceededError ou StorageDisabled falham silenciosamente sem alerta ao operador.');

console.log('\n' + '='.repeat(80));
console.log('AUDITORIA DE ITENS 3 & 4 CONCLUÍDA');
console.log('='.repeat(80));

