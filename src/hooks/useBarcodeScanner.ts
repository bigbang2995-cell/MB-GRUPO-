'use client';

import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  minCharacters?: number;
  maxIntervalMs?: number;
  enabled?: boolean;
}

/**
 * Hook para interceptar leituras de leitores de código de barras USB (dispositivos HID).
 *
 * Características e Proteções:
 * 1. Leitores USB simulam digitação de alta velocidade (< 50ms por tecla) seguida de Enter.
 * 2. Ignora eventos quando o foco já está dentro de campos de entrada (INPUT, TEXTAREA),
 *    evitando disparos duplicados entre o listener global e o formulário HTML nativo.
 * 3. Aplica debounce de hardware ultra-rápido (150ms) para filtrar repique mecânico do leitor,
 *    sem bloquear leituras físicas legítimas consecutivas.
 */
export function useBarcodeScanner({
  onScan,
  minCharacters = 3,
  maxIntervalMs = 70,
  enabled = true,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const lastScanTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;

      // Proteção anti-duplicação: Se o usuário já estiver com foco em qualquer campo de entrada
      // editável (mesmo o campo de bipagem manual), o formulário nativo tratará o evento.
      const isInputField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isInputField) {
        return;
      }

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTimeRef.current;

      // Se passou muito tempo desde o último caractere, reinicia o buffer (digitação humana manual)
      if (timeDiff > maxIntervalMs) {
        bufferRef.current = '';
      }

      lastKeyTimeRef.current = currentTime;

      if (event.key === 'Enter') {
        const scannedCode = bufferRef.current.trim();
        const now = Date.now();

        // Filtra repique físico (< 150ms entre leituras idênticas da mesma rajada)
        if (scannedCode.length >= minCharacters && now - lastScanTimeRef.current > 150) {
          lastScanTimeRef.current = now;
          event.preventDefault();
          onScan(scannedCode);
        }
        bufferRef.current = '';
        return;
      }

      // Concatena apenas caracteres imprimíveis de tamanho 1
      if (event.key.length === 1) {
        bufferRef.current += event.key;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, minCharacters, maxIntervalMs, onScan]);
}
