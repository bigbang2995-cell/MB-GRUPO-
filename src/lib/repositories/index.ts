/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Ponto Central da Camada de Repositórios (Inversion of Control)
 * ETAPA 9 — PASSO 2
 *
 * Fornece a instância singleton do repositório de estoque com base no modo de persistência
 * configurado (Local vs Supabase).
 */

import { IStockRepository } from './stock-repository.interface';
import { LocalStockRepository } from './local-stock-repository';
import { SupabaseStockRepository } from './supabase-stock-repository';

export * from './stock-repository.interface';
export * from './local-stock-repository';
export * from './supabase-stock-repository';

let activeRepositoryInstance: IStockRepository | null = null;

/**
 * Retorna a instância ativa do repositório de estoque
 * Padrão: LocalStockRepository (Demonstração local 100% segura e isolada)
 */
export function getStockRepository(): IStockRepository {
  if (activeRepositoryInstance) {
    return activeRepositoryInstance;
  }

  const isSupabaseEnabled = process.env.NEXT_PUBLIC_ENABLE_SUPABASE_PERSISTENCE === 'true';

  if (isSupabaseEnabled) {
    activeRepositoryInstance = new SupabaseStockRepository();
  } else {
    activeRepositoryInstance = new LocalStockRepository();
  }

  return activeRepositoryInstance;
}

/**
 * Permite redefinir ou injetar uma instância de repositório (útil para testes isolados)
 */
export function setStockRepositoryForTesting(repo: IStockRepository | null): void {
  activeRepositoryInstance = repo;
}

