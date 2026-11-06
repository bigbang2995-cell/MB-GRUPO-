/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Hook para Acesso ao Repositório Ativo de Estoque
 * ETAPA 9 — PASSO 2
 */

import { useMemo } from 'react';
import { getStockRepository, IStockRepository } from '@/lib/repositories';

export function useStockRepository(): IStockRepository {
  return useMemo(() => getStockRepository(), []);
}

