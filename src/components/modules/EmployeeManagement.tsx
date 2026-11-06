'use client';

/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Módulo de Gestão Administrativa de Funcionários
 * ETAPA 8 — PASSO 3
 *
 * Funcionalidades Exclusivas para Administrador:
 * 1. Consulta dos colaboradores cadastrados com seus status.
 * 2. Cadastro de novas contas com nome, login, cargo, perfil e senha inicial (SHA-256).
 * 3. Alteração cadastral de login e dados dos funcionários.
 * 4. Redefinição segura de senhas.
 * 5. Desativação e reativação de contas com bloqueio imediato de login.
 * 6. Bloqueio absoluto para operadores (RLS).
 */

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { EmployeeAccount, UserRole } from '@/types/auth';
import {
  Users,
  UserPlus,
  Search,
  Shield,
  User,
  KeyRound,
  Pencil,
  Power,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Lock,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';

export function EmployeeManagement() {
  const {
    user,
    employees,
    createEmployee,
    updateEmployee,
    resetEmployeePassword,
    toggleEmployeeStatus,
  } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'operator'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modais
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeAccount | null>(null);
  const [resetPassEmployee, setResetPassEmployee] = useState<EmployeeAccount | null>(null);

  // Formulário de Criação
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createRole, setCreateRole] = useState<UserRole>('operator');
  const [createTitle, setCreateTitle] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState('');
  const [showCreatePassword, setShowCreatePassword] = useState(false);

  // Formulário de Edição
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('operator');
  const [editTitle, setEditTitle] = useState('');

  // Formulário de Redefinição de Senha
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Estados de Feedback
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdmin = user?.role === 'admin';

  // Bloqueio RLS para Operador
  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 mb-4">
          <Lock className="h-7 w-7" />
        </div>
        <h3 className="text-base font-bold text-slate-900">
          Área Restrita a Administradores
        </h3>
        <p className="mt-2 text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
          O seu perfil ativo é <strong>Operador</strong>. A gestão de colaboradores, concessão de acessos e redefinição de credenciais são exclusivas de <strong>Administradores</strong> autenticados.
        </p>
      </div>
    );
  }

  // Filtragem de Funcionários
  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || emp.role === roleFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && emp.isActive) ||
      (statusFilter === 'inactive' && !emp.isActive);
    return matchesSearch && matchesRole && matchesStatus;
  });

  // Abertura de Modal de Criação
  const handleOpenCreate = () => {
    setCreateName('');
    setCreateEmail('');
    setCreateRole('operator');
    setCreateTitle('');
    setCreatePassword('');
    setCreatePasswordConfirm('');
    setFeedback(null);
    setIsCreateModalOpen(true);
  };

  // Submit Criação
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (createPassword !== createPasswordConfirm) {
      setFeedback({ type: 'error', text: 'A confirmação de senha não confere.' });
      return;
    }
    if (createPassword.length < 6) {
      setFeedback({ type: 'error', text: 'A senha inicial deve possuir no mínimo 6 caracteres.' });
      return;
    }

    setIsSubmitting(true);
    const res = await createEmployee({
      name: createName,
      email: createEmail,
      role: createRole,
      title: createTitle,
      initialPassword: createPassword,
    });
    setIsSubmitting(false);

    if (res.success) {
      setIsCreateModalOpen(false);
      setFeedback({ type: 'success', text: `Colaborador "${createName}" cadastrado com sucesso!` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'Falha ao cadastrar funcionário.' });
    }
  };

  // Abertura de Edição
  const handleOpenEdit = (emp: EmployeeAccount) => {
    setEditingEmployee(emp);
    setEditName(emp.name);
    setEditEmail(emp.email);
    setEditRole(emp.role);
    setEditTitle(emp.title);
    setFeedback(null);
  };

  // Submit Edição
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;

    setIsSubmitting(true);
    const res = await updateEmployee(editingEmployee.id, {
      name: editName,
      email: editEmail,
      role: editRole,
      title: editTitle,
    });
    setIsSubmitting(false);

    if (res.success) {
      setEditingEmployee(null);
      setFeedback({ type: 'success', text: `Dados de "${editName}" atualizados com sucesso!` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'Falha ao atualizar dados.' });
    }
  };

  // Abertura de Redefinição de Senha
  const handleOpenResetPassword = (emp: EmployeeAccount) => {
    setResetPassEmployee(emp);
    setNewPassword('');
    setNewPasswordConfirm('');
    setFeedback(null);
  };

  // Submit Redefinição de Senha
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPassEmployee) return;

    if (newPassword !== newPasswordConfirm) {
      setFeedback({ type: 'error', text: 'A confirmação de senha não confere.' });
      return;
    }
    if (newPassword.length < 6) {
      setFeedback({ type: 'error', text: 'A nova senha deve possuir ao menos 6 caracteres.' });
      return;
    }

    setIsSubmitting(true);
    const res = await resetEmployeePassword(resetPassEmployee.id, newPassword);
    setIsSubmitting(false);

    if (res.success) {
      const targetName = resetPassEmployee.name;
      setResetPassEmployee(null);
      setFeedback({ type: 'success', text: `Senha de "${targetName}" redefinida com sucesso!` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'Falha ao redefinir senha.' });
    }
  };

  // Toggle Ativação/Desativação
  const handleToggleStatus = async (emp: EmployeeAccount) => {
    const actionWord = emp.isActive ? 'desativar' : 'reativar';
    if (!window.confirm(`Tem certeza que deseja ${actionWord} a conta de "${emp.name}"?`)) {
      return;
    }

    const res = await toggleEmployeeStatus(emp.id);
    if (res.success) {
      setFeedback({
        type: 'success',
        text: `Conta de "${emp.name}" ${res.isActive ? 'reativada' : 'desativada'} com sucesso!`,
      });
    } else {
      setFeedback({ type: 'error', text: res.error || 'Falha ao alterar status da conta.' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner de Feedback */}
      {feedback && (
        <div
          className={`p-3.5 rounded-2xl border text-xs flex items-center justify-between font-semibold shadow-xs animate-in fade-in ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 font-bold px-1.5 py-0.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Cartão Principal de Gestão */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        {/* Cabeçalho de Ações */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" />
              Gestão Corporativa de Funcionários
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Cadastre, altere logins, redefina senhas e controle a ativação dos colaboradores com rastreabilidade nominal.
            </p>
          </div>

          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 text-white hover:bg-black font-bold text-xs transition-all shadow-xs cursor-pointer shrink-0"
          >
            <UserPlus className="h-4 w-4" />
            <span>Novo Funcionário</span>
          </button>
        </div>

        {/* Barra de Filtros */}
        <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome, e-mail/login ou cargo..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'all' | 'admin' | 'operator')}
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:bg-white focus:outline-none"
            >
              <option value="all">Todos os Perfis</option>
              <option value="admin">Administrador</option>
              <option value="operator">Operador</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:bg-white focus:outline-none"
            >
              <option value="all">Todos os Status</option>
              <option value="active">Apenas Ativos</option>
              <option value="inactive">Apenas Inativos</option>
            </select>
          </div>
        </div>

        {/* Tabela de Colaboradores */}
        <div className="mt-4 overflow-x-auto">
          {filteredEmployees.length === 0 ? (
            <div className="text-center py-10 px-4 border border-dashed border-slate-200 rounded-xl">
              <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-600">
                {employees.length === 0
                  ? 'Nenhum funcionário cadastrado no momento.'
                  : 'Nenhum colaborador encontrado com os filtros aplicados.'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {employees.length === 0
                  ? 'Clique no botão "+ Novo Funcionário" acima para cadastrar a primeira conta com identificação individual.'
                  : 'Tente alterar os termos da busca ou os filtros de perfil e status.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Colaborador</th>
                  <th className="py-2.5 px-3">Login / E-mail</th>
                  <th className="py-2.5 px-3">Perfil</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Colaborador */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-slate-900 text-white font-bold flex items-center justify-center text-xs shrink-0">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">{emp.name}</div>
                          <div className="text-[11px] text-slate-500">{emp.title}</div>
                        </div>
                      </div>
                    </td>

                    {/* Login */}
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-700">
                      {emp.email}
                    </td>

                    {/* Perfil */}
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          emp.role === 'admin'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {emp.role === 'admin' ? (
                          <Shield className="h-3 w-3" />
                        ) : (
                          <User className="h-3 w-3" />
                        )}
                        {emp.role === 'admin' ? 'Administrador' : 'Operador'}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          emp.isActive
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {emp.isActive ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <XCircle className="h-3 w-3 text-slate-500" />
                        )}
                        {emp.isActive ? 'Ativo' : 'Desativado'}
                      </span>
                    </td>

                    {/* Ações */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Editar Dados */}
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(emp)}
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                          title="Editar colaborador"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>

                        {/* Redefinir Senha */}
                        <button
                          type="button"
                          onClick={() => handleOpenResetPassword(emp)}
                          className="p-1.5 rounded-lg border border-slate-200 text-amber-700 hover:bg-amber-50 transition-colors"
                          title="Redefinir senha"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </button>

                        {/* Ativar/Desativar */}
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(emp)}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            emp.isActive
                              ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                              : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                          }`}
                          title={emp.isActive ? 'Desativar colaborador' : 'Reativar colaborador'}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Rodapé Informativo */}
        <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Total de funcionários cadastrados: <strong>{employees.length}</strong> (Ativos: {employees.filter((e) => e.isActive).length})
          </span>
          <span className="text-slate-400">
            Ambiente Local: Senhas gravadas exclusivamente com hash SHA-256.
          </span>
        </div>
      </div>

      {/* MODAL 1: CADASTRAR FUNCIONÁRIO */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-950 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-blue-400" />
                <h4 className="text-sm font-bold">Cadastrar Novo Funcionário</h4>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nome Completo *</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Ex: Lucas Pereira"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">E-mail Corporativo / Login *</label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="Ex: lucas.pereira@mbgrupo.com.br"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Perfil de Acesso *</label>
                  <select
                    value={createRole}
                    onChange={(e) => setCreateRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700"
                  >
                    <option value="operator">Operador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Cargo / Função</label>
                  <input
                    type="text"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="Ex: Operador de Expedição"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700 block">Senha Inicial (mín. 6 chars) *</label>
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword(!showCreatePassword)}
                    className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    {showCreatePassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showCreatePassword ? 'Ocultar' : 'Exibir'}
                  </button>
                </div>
                <input
                  type={showCreatePassword ? 'text' : 'password'}
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Confirmar Senha Inicial *</label>
                <input
                  type={showCreatePassword ? 'text' : 'password'}
                  value={createPasswordConfirm}
                  onChange={(e) => setCreatePasswordConfirm(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-black text-white font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Cadastrando...' : 'Cadastrar Funcionário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDITAR DADOS DO FUNCIONÁRIO */}
      {editingEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-950 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-amber-400" />
                <h4 className="text-sm font-bold">Editar Dados do Funcionário</h4>
              </div>
              <button
                onClick={() => setEditingEmployee(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-5 space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nome Completo *</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Login / E-mail Corporativo *</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Perfil de Acesso *</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700"
                  >
                    <option value="operator">Operador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Cargo / Função</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingEmployee(null)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-black text-white font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: REDEFINIR SENHA */}
      {resetPassEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-950 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-amber-400" />
                <h4 className="text-sm font-bold">Redefinir Senha</h4>
              </div>
              <button
                onClick={() => setResetPassEmployee(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="font-bold text-slate-800">{resetPassEmployee.name}</div>
                <div className="text-[11px] text-slate-500">{resetPassEmployee.email}</div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700 block">Nova Senha (mín. 6 chars) *</label>
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    {showNewPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showNewPassword ? 'Ocultar' : 'Exibir'}
                  </button>
                </div>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoFocus
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Confirmar Nova Senha *</label>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-800"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResetPassEmployee(null)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Atualizando...' : 'Atualizar Senha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
