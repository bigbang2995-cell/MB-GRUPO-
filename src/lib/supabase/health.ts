import { createServerSupabaseClient } from './server';

export type SupabaseConnectionStatus =
  | 'NOT_CONFIGURED'
  | 'NETWORK_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'TABLE_NOT_FOUND'
  | 'RLS_RESTRICTED'
  | 'CONNECTED';

export interface SupabaseHealthResult {
  status: SupabaseConnectionStatus;
  configured: boolean;
  connected: boolean;
  statusCode?: number;
  message: string;
  details?: string | null;
}

/**
 * Validação rigorosa de conectividade com o Supabase.
 *
 * Diferencia explicitamente:
 * 1. Falha de rede / Host inacessível
 * 2. Credenciais inválidas (401 / Invalid API Key / JWT Inválido)
 * 3. Tabela inexistente no schema
 * 4. Bloqueio esperado por RLS (PostgreSQL 42501 / Permissão negada a anon)
 * 5. Acesso com sucesso (HTTP 200)
 */
export async function checkSupabaseHealth(): Promise<SupabaseHealthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    supabaseUrl.includes('seu-projeto') ||
    supabaseAnonKey.includes('seu-token')
  ) {
    return {
      status: 'NOT_CONFIGURED',
      configured: false,
      connected: false,
      message: 'Credenciais ausentes no arquivo .env.local.',
      details: 'Preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no arquivo .env.local.',
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      return {
        status: 'NOT_CONFIGURED',
        configured: false,
        connected: false,
        message: 'Falha ao inicializar o cliente Supabase.',
      };
    }

    // Faz requisição HEAD estritamente para verificar resposta da API
    const { error, status } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true });

    if (error) {
      const errorMsg = (error.message || '').toLowerCase();

      // Caso 1: Chave de API inválida / Token corrompido ou expirado (HTTP 401)
      if (
        status === 401 ||
        errorMsg.includes('invalid api key') ||
        errorMsg.includes('jwt') ||
        errorMsg.includes('unauthorized')
      ) {
        return {
          status: 'INVALID_CREDENTIALS',
          configured: true,
          connected: false,
          statusCode: status,
          message: 'Credenciais rejeitadas pelo Supabase (Chave API inválida ou expirada).',
          details: `HTTP ${status}: Verifique se a chave NEXT_PUBLIC_SUPABASE_ANON_KEY foi copiada integralmente do painel (API > anon public).`,
        };
      }

      // Caso 2: Tabela não encontrada no schema (HTTP 404 ou PGRST204/PGRST200)
      if (
        status === 404 ||
        error.code === 'PGRST204' ||
        errorMsg.includes('could not find the table') ||
        errorMsg.includes('relation')
      ) {
        return {
          status: 'TABLE_NOT_FOUND',
          configured: true,
          connected: true,
          statusCode: status,
          message: 'Conectado ao Supabase, mas a tabela "products" não foi localizada.',
          details: `HTTP ${status}: Verifique o nome da tabela no painel do banco de dados (${error.message}).`,
        };
      }

      // Caso 3: Bloqueio esperado por RLS / Permissão negada pelo PostgreSQL
      if (status === 403 || error.code === '42501' || errorMsg.includes('permission denied')) {
        return {
          status: 'RLS_RESTRICTED',
          configured: true,
          connected: true,
          statusCode: status,
          message: 'Conexão confirmada com sucesso (RLS ativo bloqueando acesso anônimo).',
          details: `HTTP ${status} (PostgreSQL ${error.code}): As credenciais foram validadas e o RLS está protegendo a tabela conforme esperado.`,
        };
      }

      return {
        status: 'NETWORK_ERROR',
        configured: true,
        connected: false,
        statusCode: status,
        message: `Resposta inesperada do Supabase (${error.message}).`,
        details: `Código de erro: ${error.code || status}`,
      };
    }

    // HTTP 200 / 206 / 204
    return {
      status: 'CONNECTED',
      configured: true,
      connected: true,
      statusCode: status,
      message: 'Conexão estabelecida e tabela "products" acessível.',
      details: `HTTP ${status}: Comunicação estabelecida com sucesso.`,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Falha desconhecida';
    return {
      status: 'NETWORK_ERROR',
      configured: true,
      connected: false,
      message: 'Falha de rede ao tentar conectar ao Supabase.',
      details: `Não foi possível alcançar a URL configurada: ${errorMessage}`,
    };
  }
}
