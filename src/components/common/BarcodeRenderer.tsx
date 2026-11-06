'use client';

import React, { useMemo } from 'react';
import { encodeCode128 } from '@/lib/code128';

interface BarcodeRendererProps {
  value: string;
  height?: number; // Altura máxima da barra em pixels
  showText?: boolean; // Exibir texto legível abaixo das barras
  quietZone?: number; // Módulos da margem de silêncio lateral
  className?: string;
  textClassName?: string;
}

/**
 * Componente gráfico vetorial SVG para renderização de códigos de barras Code 128.
 * Utiliza shape-rendering="crispEdges" e fundo #ffffff para contraste e leitura óptica
 * imediata por leitores laser/CCD USB e câmeras.
 */
export function BarcodeRenderer({
  value,
  height = 55,
  showText = true,
  quietZone = 10,
  className = '',
  textClassName = 'text-xs',
}: BarcodeRendererProps) {
  const codeResult = useMemo(() => {
    return encodeCode128(value || ' ', quietZone);
  }, [value, quietZone]);

  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      <div className="w-full flex items-center justify-center bg-white p-1 rounded-sm">
        <svg
          viewBox={`0 0 ${codeResult.totalWidth} 100`}
          className="w-full"
          style={{ height: `${height}px`, minWidth: '160px' }}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
          xmlns="http://www.w3.org/2000/svg"
          aria-label={`Código de barras Code 128 para ${value}`}
        >
          {/* Fundo branco de contraste máximo */}
          <rect width={codeResult.totalWidth} height="100" fill="#ffffff" />
          {/* Barras pretas vetoriais exatas */}
          <path d={codeResult.svgPath} fill="#000000" />
        </svg>
      </div>

      {showText && (
        <span
          className={`font-mono font-bold tracking-widest text-slate-900 mt-1 ${textClassName}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

