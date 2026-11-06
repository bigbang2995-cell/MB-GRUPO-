/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Middleware de Renovação de Sessão e Proteção de Rotas (Next.js Edge / Node.js)
 * ETAPA 8 — PASSO 4
 *
 * Características:
 * 1. Opera em modo pass-through transparente durante o ambiente de simulação local.
 * 2. Preparado para renovação automática de cookies de sessão (@supabase/ssr) quando
 *    a autenticação real for ativada expressamente via NEXT_PUBLIC_ENABLE_SUPABASE_AUTH.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  const isRealAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_SUPABASE_AUTH === 'true';

  // Se não estiver ativado o Supabase Auth real, passa direto (modo simulação local)
  if (!isRealAuthEnabled) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Atualiza a sessão sem quebrar o fluxo
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Aplica nas rotas da aplicação, exceto arquivos estáticos, favicon e imagens
     */
    '/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

