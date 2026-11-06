/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Credenciais de Demonstração Local e Tratamento de Ambiente
 * ETAPA 8 — PASSO 3 / FASE 2 VERCEL DEMO
 *
 * REGRAS DE SEGURANÇA E GOVERNANÇA:
 * 1. Nomes fictícios de colaboradores eliminados por completo ('Administrador' e 'Operador').
 * 2. Disponibilizar perfis de teste exclusivamente em ambiente de SIMULAÇÃO LOCAL / DEMO.
 * 3. Se a autenticação real do Supabase for ativada (NEXT_PUBLIC_ENABLE_SUPABASE_AUTH === 'true'),
 *    as contas demo são OBRIGATORIAMENTE desativadas (array vazio []), impedindo acesso indevido.
 * 4. NUNCA armazenar senhas em texto puro (utilizar exclusivamente hashes criptográficos SHA-256).
 */

import type { AuthenticatedUser } from '../types/auth';

export interface DemoUserRecord extends AuthenticatedUser {
  passwordHashSha256: string;
}

/**
 * Flag de proteção estrita contra vazamento de contas em produção real:
 * Contas demo ficam habilitadas quando:
 * - A autenticação real do Supabase NÃO estiver ativa (modo simulação local / protótipo Vercel);
 * - E não houver desativação explícita via NEXT_PUBLIC_ENABLE_DEMO_USERS=false.
 */
const isRealAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_SUPABASE_AUTH === 'true';
const isDemoModeDisabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_USERS === 'false';

export const ARE_DEMO_USERS_ENABLED = !isRealAuthEnabled && !isDemoModeDisabled;

export const DEMO_USERS: DemoUserRecord[] = ARE_DEMO_USERS_ENABLED
  ? [
      {
        id: 'usr-admin-demo',
        name: 'Administrador',
        email: 'admin@mbgrupo.com.br',
        role: 'admin',
        title: 'Administrador de Estoque',
        isDemoUser: true,
        isActive: true,
        passwordHashSha256: 'e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7',
      },
      {
        id: 'usr-operator-demo',
        name: 'Operador',
        email: 'operador@mbgrupo.com.br',
        role: 'operator',
        title: 'Operador de Estoque',
        isDemoUser: true,
        isActive: true,
        passwordHashSha256: 'fad2aef935a11726db1fbf77b47bcc4caf7a130706e7ba686bbc49176f2654da',
      },
    ]
  : [];

/**
 * Busca colaborador de demonstração pelo e-mail normalizado
 */
export function findDemoUserByEmail(email: string): DemoUserRecord | undefined {
  if (!ARE_DEMO_USERS_ENABLED) return undefined;
  const normalized = (email || '').trim().toLowerCase();
  return DEMO_USERS.find((u) => u.email.toLowerCase() === normalized);
}

/**
 * Busca colaborador de demonstração pelo ID único
 */
export function findDemoUserById(id: string): DemoUserRecord | undefined {
  if (!ARE_DEMO_USERS_ENABLED) return undefined;
  return DEMO_USERS.find((u) => u.id === id);
}

/**
 * Sanitiza o registro de usuário para a sessão (elimina hashes)
 */
export function sanitizeUser(user: {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'operator';
  title: string;
  isDemoUser?: boolean;
  isActive?: boolean;
}): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    title: user.title,
    isDemoUser: user.isDemoUser ?? false,
    isActive: user.isActive ?? true,
  };
}
