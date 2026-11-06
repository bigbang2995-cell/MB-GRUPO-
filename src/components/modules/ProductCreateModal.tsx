'use client';

import React, { useState, useRef } from 'react';
import { Product, ProductVariant } from '@/types/database';
import { createProductWithVariants } from '@/lib/barcode-service';
import { compressImage } from '@/lib/image-utils';
import { X, Plus } from 'lucide-react';

interface ProductCreateModalProps {
  existingVariants: (ProductVariant & { product?: Product })[];
  onClose: () => void;
  onSuccess: (product: Product, variants: (ProductVariant & { product: Product })[]) => void;
}

const PREDEFINED_SIZES = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2'];

export function ProductCreateModal({
  existingVariants,
  onClose,
  onSuccess,
}: ProductCreateModalProps) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [colors, setColors] = useState<string[]>(['']);
  const [sizesEnabled, setSizesEnabled] = useState(false);
  const [selectedSizes, setSelectedSizes] = useState<string[]>(['P', 'M', 'G']);
  const [customSizeInput, setCustomSizeInput] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manipulação de cores
  const handleAddColor = () => {
    setColors((prev) => [...prev, '']);
  };

  const handleUpdateColor = (index: number, val: string) => {
    setColors((prev) => {
      const copy = [...prev];
      copy[index] = val;
      return copy;
    });
  };

  const handleRemoveColor = (index: number) => {
    if (colors.length <= 1) {
      setColors(['']);
      return;
    }
    setColors((prev) => prev.filter((_, i) => i !== index));
  };

  // Manipulação de tamanhos
  const handleAddPredefinedSize = (sizeToAdd: string) => {
    if (!selectedSizes.includes(sizeToAdd)) {
      setSelectedSizes((prev) => [...prev, sizeToAdd]);
    }
  };

  const handleAddCustomSize = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = customSizeInput.trim().toUpperCase();
    if (clean && !selectedSizes.includes(clean)) {
      setSelectedSizes((prev) => [...prev, clean]);
      setCustomSizeInput('');
    }
  };

  const handleRemoveSize = (sizeToRemove: string) => {
    if (selectedSizes.length <= 1) return;
    setSelectedSizes((prev) => prev.filter((s) => s !== sizeToRemove));
  };

  // Upload e compressão de foto
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsCompressing(true);
      setErrorMessage(null);
      const compressedDataUrl = await compressImage(file, 600, 600, 0.75);
      setImagePreview(compressedDataUrl);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao processar a imagem.');
    } finally {
      setIsCompressing(false);
    }
  };

  const handleRemovePhoto = () => {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Submissão do formulário
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!sku.trim()) {
      setErrorMessage('O SKU é obrigatório.');
      return;
    }

    if (!name.trim()) {
      setErrorMessage('O Nome do produto é obrigatório.');
      return;
    }

    const cleanColors = colors.map((c) => c.trim()).filter((c) => c.length > 0);
    if (cleanColors.length === 0) {
      setErrorMessage('Informe ao menos uma cor para o produto.');
      return;
    }

    if (sizesEnabled && selectedSizes.length === 0) {
      setErrorMessage('Selecione ou adicione ao menos um tamanho.');
      return;
    }

    try {
      const result = createProductWithVariants({
        productSku: sku,
        productName: name,
        colors: cleanColors,
        sizes: selectedSizes,
        sizesEnabled,
        imagePath: imagePreview,
        existingVariants,
      });

      onSuccess(result.product, result.variants);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao cadastrar produto.');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 my-8">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Novo SKU</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cadastre o produto, suas cores e o estoque inicial.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {errorMessage && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Campo SKU */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              SKU *
            </label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Ex.: 0032 ou cj-900"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              required
            />
          </div>

          {/* Nome do Produto */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Nome do produto *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Jaqueta corta vento"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Cores e estoque inicial */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Cores e estoque inicial *
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2">
              <div className="grid grid-cols-[1fr_80px_36px] gap-2 px-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <span>Cor</span>
                <span className="text-center">Quantidade</span>
                <span />
              </div>

              {colors.map((colorVal, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_80px_36px] gap-2 items-center">
                  <input
                    type="text"
                    value={colorVal}
                    onChange={(e) => handleUpdateColor(idx, e.target.value)}
                    placeholder="Ex.: Preta"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                  {/* Regra Obrigatória: Saldo ZERO desabilitado */}
                  <input
                    type="text"
                    value="0"
                    disabled
                    title="Novas variações iniciam com saldo 0 conforme regra do sistema"
                    className="w-full px-2 py-2 text-xs font-mono text-center bg-slate-100 border border-slate-200 rounded-lg text-slate-500 font-bold cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveColor(idx)}
                    className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 text-rose-500 hover:bg-rose-50 hover:border-rose-300 transition-colors"
                    title="Remover cor"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddColor}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar cor
            </button>
          </div>

          {/* Opção: Este produto possui tamanhos */}
          <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/30">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-900 block">
                  Este produto possui tamanhos
                </span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  Ative somente para peças que precisam de controle por tamanho.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSizesEnabled(!sizesEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  sizesEnabled ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    sizesEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Painel expandido de tamanhos */}
            {sizesEnabled && (
              <div className="mt-4 pt-3 border-t border-slate-200 space-y-3">
                {/* Seletores rápidos de tamanho */}
                <div>
                  <span className="text-[11px] font-bold text-slate-500 block mb-1.5">
                    Tamanhos ativos:
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedSizes.map((sz) => (
                      <span
                        key={sz}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold"
                      >
                        {sz}
                        <button
                          type="button"
                          onClick={() => handleRemoveSize(sz)}
                          className="hover:text-blue-900 cursor-pointer"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Predefinidos + Adicionar Custom */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[11px] text-slate-400">Predefinidos:</span>
                  {PREDEFINED_SIZES.map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => handleAddPredefinedSize(sz)}
                      disabled={selectedSizes.includes(sz)}
                      className={`px-2 py-0.5 text-xs font-semibold rounded-md border transition-colors ${
                        selectedSizes.includes(sz)
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 cursor-pointer'
                      }`}
                    >
                      +{sz}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={customSizeInput}
                    onChange={(e) => setCustomSizeInput(e.target.value)}
                    placeholder="EX.: XG"
                    className="w-24 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddCustomSize()}
                    className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-2xs"
                  >
                    + Tamanho
                  </button>
                </div>

                {/* Matriz Dinâmica de Cores x Tamanhos */}
                <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                      <tr>
                        <th className="px-3 py-2">Cor</th>
                        {selectedSizes.map((sz) => (
                          <th key={sz} className="px-2 py-2 text-center">
                            {sz}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right">Saldo Inicial</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-mono text-[11px]">
                      {colors
                        .filter((c) => c.trim().length > 0)
                        .map((c, cIdx) => (
                          <tr key={cIdx} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2 font-sans font-semibold text-slate-900">
                              {c}
                            </td>
                            {selectedSizes.map((sz) => (
                              <td key={sz} className="px-2 py-2 text-center text-slate-400">
                                0 un
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right font-bold text-emerald-700">
                              0 un
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* FOTO DO PRODUTO */}
          <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/30">
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
              FOTO DO PRODUTO
            </label>

            <div className="flex items-center gap-3.5">
              {/* Box de Prévia */}
              <div className="h-16 w-16 shrink-0 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shadow-2xs">
                {imagePreview ? (
                  <img src={imagePreview} alt="Foto Produto" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] font-black text-slate-400 tracking-tight text-center">
                    SEM FOTO
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />

                {!imagePreview ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isCompressing}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {isCompressing ? 'Comprimindo...' : '+ Adicionar foto'}
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      Mudar foto
                    </button>
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="text-xs font-bold text-rose-600 hover:text-rose-800 transition-colors cursor-pointer"
                    >
                      Remover foto
                    </button>
                  </div>
                )}

                <p className="text-[11px] text-slate-400">
                  A imagem será reduzida automaticamente para economizar espaço.
                </p>
              </div>
            </div>
          </div>

          {/* Banner de Informação de SKU */}
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-xs text-slate-600 leading-relaxed">
            O SKU precisa ser único. Você poderá alterar o estoque depois normalmente pelo sistema.
          </div>

          {/* Botões do Rodapé */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 text-xs font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 shadow-xs transition-colors cursor-pointer"
            >
              Cadastrar produto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

