/**
 * MB GRUPO — SERVIÇO DE TABELA DE PREÇOS DE REPASSE (ACERTO ENTRE LOJAS)
 *
 * Gerencia os valores unitários de repasse por variação (variantId estável),
 * persistência local isolada e trilha de auditoria completa.
 *
 * Regra Crítica:
 * - Precisão de centavos (2 casas decimais).
 * - Preço zero somente permitido se cadastrado expressamente.
 * - Valores negativos proibidos.
 * - Operações exclusivas para perfil Administrador.
 */

import {
  StoreTransferPrice,
  StoreTransferPriceAuditLog,
} from '@/types/store-transfers';
import {
  safeGetStorage,
  safeSetStorage,
  STORAGE_KEY_STORE_TRANSFER_PRICES,
  STORAGE_KEY_STORE_TRANSFER_PRICE_AUDIT,
} from '@/lib/storage-service';

/**
 * Retorna o mapa de todos os preços de repasse cadastrados, indexados por variantId.
 */
export function getStoreTransferPrices(): Record<string, StoreTransferPrice> {
  const res = safeGetStorage<Record<string, StoreTransferPrice>>(STORAGE_KEY_STORE_TRANSFER_PRICES);
  if (res.success && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
    return res.data;
  }
  return {};
}

/**
 * Consulta o preço de repasse de uma variação específica.
 */
export function getStoreTransferPriceByVariantId(variantId: string): StoreTransferPrice | null {
  const prices = getStoreTransferPrices();
  return prices[variantId] || null;
}

/**
 * Retorna os logs de auditoria de alterações de preços.
 */
export function getStoreTransferPriceAuditLogs(): StoreTransferPriceAuditLog[] {
  const res = safeGetStorage<StoreTransferPriceAuditLog[]>(STORAGE_KEY_STORE_TRANSFER_PRICE_AUDIT);
  if (res.success && Array.isArray(res.data)) {
    return res.data;
  }
  return [];
}

export interface SavePriceParams {
  variantId: string;
  productId: string;
  sku: string;
  barcode: string;
  productName: string;
  variantLabel: string;
  transferPrice: number;
  operatorId: string;
  operatorName: string;
  note?: string;
  reason?: string;
}

/**
 * Cadastra ou atualiza o preço de repasse de uma variação com log de auditoria.
 */
export function saveStoreTransferPrice(params: SavePriceParams): {
  success: boolean;
  price?: StoreTransferPrice;
  auditLog?: StoreTransferPriceAuditLog;
  error?: string;
} {
  const {
    variantId,
    productId,
    sku,
    barcode,
    productName,
    variantLabel,
    transferPrice,
    operatorId,
    operatorName,
    note,
    reason,
  } = params;

  if (!variantId || !variantId.trim()) {
    return { success: false, error: 'Identificador de variação (variantId) inválido.' };
  }

  if (typeof transferPrice !== 'number' || isNaN(transferPrice)) {
    return { success: false, error: 'O valor de repasse deve ser um número válido.' };
  }

  if (transferPrice < 0) {
    return { success: false, error: 'O valor de repasse não pode ser negativo.' };
  }

  // Normalização de centavos para evitar erros de ponto flutuante
  const normalizedPrice = Math.round(transferPrice * 100) / 100;
  const nowIso = new Date().toISOString();

  const currentPrices = getStoreTransferPrices();
  const existingPrice = currentPrices[variantId];
  const previousPrice = existingPrice ? existingPrice.transferPrice : null;

  const newPriceRecord: StoreTransferPrice = {
    variantId,
    productId,
    sku,
    barcode,
    transferPrice: normalizedPrice,
    updatedAt: nowIso,
    updatedBy: operatorId || 'usr-admin-demo',
    updatedByName: operatorName || 'Administrador',
    note: note?.trim() || undefined,
  };

  currentPrices[variantId] = newPriceRecord;
  const savePriceRes = safeSetStorage(STORAGE_KEY_STORE_TRANSFER_PRICES, currentPrices);
  if (!savePriceRes.success) {
    return { success: false, error: savePriceRes.error || 'Falha ao gravar preço no armazenamento local.' };
  }

  // Gera registro de auditoria
  const auditLog: StoreTransferPriceAuditLog = {
    id: `audit-price-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    variantId,
    productId,
    sku,
    barcode,
    productName,
    variantLabel,
    previousPrice,
    newPrice: normalizedPrice,
    changedAt: nowIso,
    changedBy: operatorId || 'usr-admin-demo',
    changedByName: operatorName || 'Administrador',
    reason: reason?.trim() || (previousPrice === null ? 'Cadastro inicial de preço de repasse' : 'Atualização de preço de repasse'),
  };

  const currentLogs = getStoreTransferPriceAuditLogs();
  const updatedLogs = [auditLog, ...currentLogs];
  safeSetStorage(STORAGE_KEY_STORE_TRANSFER_PRICE_AUDIT, updatedLogs);

  return {
    success: true,
    price: newPriceRecord,
    auditLog,
  };
}

/**
 * Atualização em lote de preços de repasse.
 */
export function batchSaveStoreTransferPrices(
  entries: Array<{
    variantId: string;
    productId: string;
    sku: string;
    barcode: string;
    productName: string;
    variantLabel: string;
    transferPrice: number;
    note?: string;
  }>,
  operatorId: string,
  operatorName: string,
  commonReason?: string
): { success: boolean; count: number; error?: string } {
  let count = 0;
  for (const entry of entries) {
    const res = saveStoreTransferPrice({
      ...entry,
      operatorId,
      operatorName,
      reason: commonReason || 'Atualização de preços em lote',
    });
    if (res.success) {
      count++;
    }
  }
  return { success: true, count };
}

