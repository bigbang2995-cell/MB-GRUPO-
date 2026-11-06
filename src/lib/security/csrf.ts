/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Módulo de Proteção Anti-CSRF e Validação de Origens Seguras
 * ETAPA 8 — PASSO 6 (VULN-03)
 *
 * REQUISITOS OFICIAIS:
 * 1. Validar Origin contra a origem pública configurada e confiável do servidor.
 * 2. Utilizar Fetch Metadata (Sec-Fetch-Site, Sec-Fetch-Mode) como camada adicional de defesa.
 * 3. Rejeitar requisições inválidas ou de origens cruzadas não autorizadas (HTTP 403 Forbidden).
 * 4. Não confiar cegamente nos cabeçalhos Host ou X-Forwarded-Host (evita Host Header Injection).
 * 5. Preservar proteção de sessão e autorização no servidor.
 */

import type { NextRequest } from 'next/server';

/**
 * Normaliza uma URL ou origem removendo barras finais e convertendo para minúsculas
 */
function normalizeOrigin(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return urlStr.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Obtém a lista de origens confiáveis explicitamente configuradas
 * REGRA: Não confia no cabeçalho Host ou X-Forwarded-Host da requisição
 */
export function getTrustedOrigins(): string[] {
  const trusted: string[] = [];

  // Origem pública oficial configurada no ambiente
  if (process.env.APP_URL) {
    trusted.push(normalizeOrigin(process.env.APP_URL));
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    trusted.push(normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL));
  }
  if (process.env.ALLOWED_ORIGIN) {
    trusted.push(normalizeOrigin(process.env.ALLOWED_ORIGIN));
  }

  // Ambientes oficiais Vercel configurados para esta implantação
  if (process.env.VERCEL_URL) {
    trusted.push(normalizeOrigin(`https://${process.env.VERCEL_URL}`));
  }
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    trusted.push(normalizeOrigin(`https://${process.env.NEXT_PUBLIC_VERCEL_URL}`));
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    trusted.push(normalizeOrigin(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`));
  }
  if (process.env.VERCEL_BRANCH_URL) {
    trusted.push(normalizeOrigin(`https://${process.env.VERCEL_BRANCH_URL}`));
  }

  // Em ambiente de desenvolvimento local / testes / modo de simulação
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_SUPABASE_AUTH !== 'true') {
    trusted.push(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001'
    );
  }

  // Fallback seguro caso nenhuma variável esteja configurada
  if (trusted.length === 0) {
    trusted.push('http://localhost:3000');
  }

  return Array.from(new Set(trusted));
}

export interface CsrfValidationResult {
  valid: boolean;
  status?: number;
  error?: string;
}

/**
 * Valida se uma requisição administrativa atende aos critérios de segurança anti-CSRF
 * Mutações (POST, PUT, PATCH, DELETE) são estritamente verificadas
 */
export function validateCsrfProtection(req: NextRequest): CsrfValidationResult {
  const method = req.method.toUpperCase();

  // Métodos seguros (leitura) não alteram estado no servidor
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return { valid: true };
  }

  // 1. Defesa em Profundidade: Fetch Metadata (Sec-Fetch-Site)
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite) {
    const site = secFetchSite.toLowerCase().trim();
    if (site === 'cross-site') {
      return {
        valid: false,
        status: 403,
        error: 'Acesso negado (CSRF): Requisição bloqueada por origem cruzada (Sec-Fetch-Site: cross-site).',
      };
    }
  }

  // 2. Validação Estrita do Cabeçalho Origin
  const origin = req.headers.get('origin');
  const trustedOrigins = getTrustedOrigins();

  if (origin) {
    const normalizedOrigin = normalizeOrigin(origin);
    const isOriginTrusted = trustedOrigins.some((t) => t === normalizedOrigin);

    if (!isOriginTrusted) {
      return {
        valid: false,
        status: 403,
        error: `Acesso negado (CSRF): A origem "${origin}" não está na lista de origens confiáveis do servidor.`,
      };
    }

    return { valid: true };
  }

  // 3. Fallback para Cabeçalho Referer caso Origin esteja ausente
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const refererOrigin = normalizeOrigin(referer);
      const isRefererTrusted = trustedOrigins.some((t) => t === refererOrigin);

      if (!isRefererTrusted) {
        return {
          valid: false,
          status: 403,
          error: `Acesso negado (CSRF): O referer "${referer}" possui origem não autorizada.`,
        };
      }

      return { valid: true };
    } catch {
      return {
        valid: false,
        status: 403,
        error: 'Acesso negado (CSRF): Cabeçalho Referer inválido.',
      };
    }
  }

  // 4. Se Origin e Referer estiverem ausentes em uma mutação do navegador
  // Requer cabeçalho customizado x-requested-with para comprovar requisição legítima de script local
  const customHeader = req.headers.get('x-requested-with');
  if (customHeader) {
    return { valid: true };
  }

  // Em ambiente de desenvolvimento/teste sem browser real (ex: script de teste local),
  // permite se o cabeçalho 'x-test-suite' ou 'sec-fetch-site: same-origin' estiver presente
  if (
    (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_SUPABASE_AUTH !== 'true') &&
    (req.headers.get('x-test-suite') || req.headers.get('sec-fetch-mode') === 'same-origin')
  ) {
    return { valid: true };
  }

  return {
    valid: false,
    status: 403,
    error: 'Acesso negado (CSRF): Ausência de comprovação de origem (Origin, Referer ou X-Requested-With).',
  };
}

