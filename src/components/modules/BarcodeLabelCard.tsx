'use client';

import React from 'react';
import { ProductVariant, Product } from '@/types/database';
import { BarcodeRenderer } from '@/components/common/BarcodeRenderer';
import { Tag } from 'lucide-react';

interface BarcodeLabelCardProps {
  variant: ProductVariant & { product: Product };
  isPrintOnly?: boolean;
  copies?: number;
}

/**
 * Renderiza uma etiqueta física individual de 40 mm × 30 mm
 */
export function SingleLabel40x30({
  variant,
  className = '',
}: {
  variant: ProductVariant & { product: Product };
  className?: string;
}) {
  const barcode = variant.barcode || '7890000000000';
  const productName = variant.product?.name || 'Produto MB Grupo';
  const sku = variant.product?.sku || 'SKU';
  const color = variant.color || 'PADRÃO';
  const size = variant.size || 'UN';

  return (
    <div
      className={`w-[40mm] h-[30mm] bg-white text-black box-border p-[1.8mm_2mm_1.5mm_2mm] flex flex-col justify-between overflow-hidden select-none ${className}`}
      style={{ width: '40mm', height: '30mm' }}
    >
      {/* Topo: MB GRUPO + SKU */}
      <div className="flex items-center justify-between border-b-[0.3mm] border-black pb-[0.4mm]">
        <div className="flex items-center gap-[1mm]">
          <span className="bg-black text-white text-[5pt] font-black px-[0.8mm] py-[0.2mm] rounded-[0.4mm] leading-none">
            MB
          </span>
          <span className="text-[5.5pt] font-black tracking-wider text-black uppercase leading-none">
            MB GRUPO
          </span>
        </div>
        <span className="font-mono text-[5.5pt] font-extrabold text-black leading-none">
          {sku}
        </span>
      </div>

      {/* Nome do Produto */}
      <div
        className="text-[5.8pt] font-black text-black uppercase truncate mt-[0.3mm] leading-tight"
        title={productName}
      >
        {productName}
      </div>

      {/* Cor e Tamanho */}
      <div className="flex items-center justify-between text-[5pt] font-bold text-black mt-[0.2mm] leading-none">
        <span className="truncate max-w-[26mm]">COR: {color.toUpperCase()}</span>
        <span className="border-[0.3mm] border-black px-[0.8mm] py-[0.2mm] rounded-[0.4mm] font-black">
          TAM: {size}
        </span>
      </div>

      {/* Código de Barras Code 128 */}
      <div className="flex flex-col items-center justify-center mt-[0.4mm]">
        <div className="w-[35mm] h-[10.5mm] flex items-center justify-center overflow-hidden">
          <BarcodeRenderer
            value={barcode}
            height={40}
            showText={false}
            quietZone={10}
            className="w-full"
          />
        </div>
        <span className="font-mono text-[5.8pt] font-extrabold tracking-widest text-black mt-[0.2mm] leading-none">
          {barcode}
        </span>
      </div>
    </div>
  );
}

/**
 * Renderiza o par de etiquetas 82 mm × 30 mm para o rolo contínuo de 2 colunas
 * - Etiqueta Esquerda: X = 0 mm (40 mm)
 * - Espaço horizontal: 2 mm (de 40 a 42 mm)
 * - Etiqueta Direita: X = 42 mm (40 mm)
 */
export function LabelPairRow82x30({
  variant,
}: {
  variant: ProductVariant & { product: Product };
}) {
  return (
    <div
      className="print-label-pair relative bg-white overflow-hidden"
      style={{
        width: '82mm',
        height: '30mm',
        pageBreakAfter: 'always',
        breakAfter: 'page',
        pageBreakInside: 'avoid',
        breakInside: 'avoid',
      }}
    >
      {/* Etiqueta Esquerda em X = 0 mm */}
      <div
        className="absolute top-0 left-0"
        style={{ left: '0mm', top: '0mm', width: '40mm', height: '30mm' }}
      >
        <SingleLabel40x30 variant={variant} />
      </div>

      {/* Etiqueta Direita em X = 42 mm (após gap de 2 mm) */}
      <div
        className="absolute top-0"
        style={{ left: '42mm', top: '0mm', width: '40mm', height: '30mm' }}
      >
        <SingleLabel40x30 variant={variant} />
      </div>
    </div>
  );
}

/**
 * Componente de Card em Tela (UI) para o módulo de etiquetas
 */
export function BarcodeLabelCard({
  variant,
  isPrintOnly = false,
}: BarcodeLabelCardProps) {
  const barcode = variant.barcode || '7890000000000';
  const productName = variant.product?.name || 'Produto MB Grupo';
  const sku = variant.product?.sku || 'SKU-INDEFINIDO';
  const color = variant.color;
  const size = variant.size;

  if (isPrintOnly) {
    return <LabelPairRow82x30 variant={variant} />;
  }

  return (
    <div className="relative flex flex-col justify-between rounded-xl border border-slate-300 bg-white p-4 shadow-xs hover:shadow-md transition-all">
      {/* Topo da Etiqueta */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-slate-900 text-[10px] font-extrabold text-white">
            MB
          </div>
          <span className="text-xs font-bold tracking-wider text-slate-900 uppercase">
            MB GRUPO
          </span>
        </div>
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
          <Tag className="h-3 w-3 text-slate-400" />
          {sku}
        </span>
      </div>

      {/* Descrição do Produto & Variação */}
      <div className="my-3 space-y-1.5">
        <h4 className="text-xs font-bold text-slate-900 leading-snug line-clamp-2" title={productName}>
          {productName}
        </h4>
        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-slate-600 font-medium">
            Cor: <strong className="text-slate-900 font-semibold">{color}</strong>
          </span>
          <span className="inline-flex items-center rounded-md bg-slate-900 text-white font-bold px-2 py-0.5 text-xs">
            Tam: {size}
          </span>
        </div>
      </div>

      {/* Código de Barras Gráfico Code 128 */}
      <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200 flex flex-col items-center">
        <BarcodeRenderer
          value={barcode}
          height={48}
          showText={true}
          textClassName="text-xs tracking-widest text-slate-900"
        />
        <div className="mt-1 flex items-center justify-between w-full text-[10px] text-slate-400 px-1 border-t border-slate-200/60 pt-1">
          <span>Padrão Code 128</span>
          <span className="font-semibold text-indigo-600">Par 82×30mm (2 colunas)</span>
        </div>
      </div>
    </div>
  );
}
