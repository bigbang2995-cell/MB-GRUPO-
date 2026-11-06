/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Utilitário de Criptografia e Hashing Seguro
 * ETAPA 8 — PASSO 2
 *
 * Regra Obrigatória: NUNCA armazenar senhas em texto puro no código,
 * em trânsito ou no localStorage.
 */

export async function hashPasswordSha256(password: string): Promise<string> {
  const normalized = (password || '').trim();
  if (!normalized) return '';

  // 1. Execução no Navegador (Web Crypto API padrão W3C)
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(normalized);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (err) {
      console.warn('[auth-crypto] Web Crypto falhou, executando fallback:', err);
    }
  }

  // 2. Execução no Servidor / Node.js (Testes, SSR e Fallback)
  try {
    const cryptoModule = await import('crypto');
    return cryptoModule.createHash('sha256').update(normalized).digest('hex');
  } catch {
    throw new Error('Ambiente criptográfico não disponível para geração de hash SHA-256.');
  }
}

