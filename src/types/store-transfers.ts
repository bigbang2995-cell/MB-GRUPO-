/**
 * MB GRUPO — CONTRATOS DE TIPAGEM: ACERTO ENTRE LOJAS
 * Módulo Administrativo de Empréstimos e Transferências entre Bia e Carlos
 * ETAPA: MÓDULO COMPLEMENTAR — PASSO 1
 */

export type StoreTransferDirection = 'bia_from_carlos' | 'carlos_from_bia';

export interface StoreTransferRecord {
  id: string;
  direction: StoreTransferDirection;
  originStore: 'Loja do Carlos' | 'Loja da Bia';
  destinationStore: 'Loja da Bia' | 'Loja do Carlos';
  productId: string;
  productName: string;
  sku: string;
  variantId: string;
  color: string;
  size: string;
  barcode: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
  hasPendingPrice?: boolean;
  stockDeducted?: boolean;
  stockMovementId?: string | null;
  createdAt: string;
  operatorId: string;
  operatorName: string;
  method: 'manual' | 'scanner';
  isSettled: boolean;
  settlementId?: string | null;
  batchId?: string | null;
  idempotencyKey?: string | null;
  imagePath?: string | null;
  note?: string;
}

export interface StoreTransferBatchItem {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  color: string;
  size: string;
  barcode: string;
  imagePath?: string | null;
  quantity: number;
  currentStock?: number;
  unitPrice: number | null;
  hasConfiguredPrice: boolean;
  totalPrice: number;
  method: 'scanner' | 'manual';
}

/**
 * Tabela de Preços de Repasse por Variação
 * Associada diretamente ao variantId estável da peça
 */
export interface StoreTransferPrice {
  variantId: string;
  productId: string;
  sku: string;
  barcode: string;
  transferPrice: number; // Precisão de centavos (ex: 45.00)
  updatedAt: string;
  updatedBy: string; // operatorId
  updatedByName: string; // operatorName
  note?: string;
}

/**
 * Log de Auditoria de Alterações na Tabela de Preços
 */
export interface StoreTransferPriceAuditLog {
  id: string;
  variantId: string;
  productId: string;
  sku: string;
  barcode: string;
  productName: string;
  variantLabel: string;
  previousPrice: number | null;
  newPrice: number;
  changedAt: string;
  changedBy: string;
  changedByName: string;
  reason?: string;
}

export interface MonthlySettlement {
  id: string;
  monthKey: string; // Ex: '2026-11'
  monthLabel: string; // Ex: 'Novembro / 2026'
  closedAt: string;
  closedBy: string;
  closedByName: string;
  totalBiaOwesCarlos: number;
  totalCarlosOwesBia: number;
  compensationAmount: number;
  netBalance: number;
  netDebtor: 'Bia' | 'Carlos' | 'Nenhum';
  transfersCount: number;
  transferIds: string[];
  status: 'closed';
  note?: string;
}

export interface StoreBalanceSummary {
  totalBiaOwesCarlos: number;
  totalCarlosOwesBia: number;
  netAmount: number;
  netDebtor: 'Bia' | 'Carlos' | 'Nenhum';
  totalPiecesBiaFromCarlos: number;
  totalPiecesCarlosFromBia: number;
  totalPieces: number;
  openTransfersCount: number;
  settledTransfersCount: number;
}

