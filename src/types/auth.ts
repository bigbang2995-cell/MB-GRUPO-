/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Tipos e Contratos de Autenticação, Perfis e Gestão de Funcionários
 * ETAPA 8 — PASSO 3
 */

import { UserRole } from './database';
export type { UserRole };

export interface AuthenticatedUser {
  id: string; // Identificador do colaborador (ex: 'usr-admin-demo' ou 'usr-func-1730560000000')
  name: string; // Nome oficial (ex: 'Administrador', 'Operador' ou nome real cadastrado)
  email: string; // E-mail corporativo / login
  role: UserRole; // 'admin' ou 'operator'
  title: string; // Cargo/função operacional
  isDemoUser?: boolean; // Indicador de usuário genérico de demonstração local
  isActive?: boolean; // Status de ativação da conta
}

export interface AuthSession {
  user: AuthenticatedUser;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface EmployeeAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  title: string;
  passwordHashSha256: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeeInput {
  name: string;
  email: string;
  role: UserRole;
  title: string;
  initialPassword: string;
}

export interface UpdateEmployeeInput {
  name: string;
  email: string;
  role: UserRole;
  title: string;
}

export interface UpdateAdminAccountInput {
  currentPassword: string;
  newName?: string;
  newEmail?: string;
  newPassword?: string;
}

export interface AuthContextType {
  user: AuthenticatedUser | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isDemoMode: boolean;
  authMode: 'simulation' | 'supabase_auth';
  error: string | null;
  employees: EmployeeAccount[];
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  switchOperator: () => Promise<void>;
  clearError: () => void;
  // Gestão Administrativa de Funcionários (Exclusiva para Administrador)
  createEmployee: (input: CreateEmployeeInput) => Promise<{ success: boolean; error?: string; employee?: EmployeeAccount }>;
  updateEmployee: (id: string, input: UpdateEmployeeInput) => Promise<{ success: boolean; error?: string }>;
  resetEmployeePassword: (id: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  toggleEmployeeStatus: (id: string) => Promise<{ success: boolean; error?: string; isActive?: boolean }>;
  // Gestão da Conta do Administrador
  updateAdminAccount: (input: UpdateAdminAccountInput) => Promise<{ success: boolean; error?: string }>;
}
