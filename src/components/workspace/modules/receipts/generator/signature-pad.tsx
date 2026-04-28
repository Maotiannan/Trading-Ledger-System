'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type SignaturePadProps = {
  label: string;
  tx: (zh: string, en: string) => string;
  value: string | null;
  onChange: (value: string | null) => void;
  mobileMode?: boolean;
  showClearButton?: boolean;
  hideHeader?: boolean;
  frameClassName?: string;
  canvasClassName?: string;
};

export function SignaturePad({
  label,
  tx,
  value,
  onChange,
  mobileMode = false,
  showClearButton = true,
  hideHeader = false,
  frameClassName = '',
  canvasClassName = '',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const resize = () => {
      const rect = frame.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(height * pixelRatio));

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = '#111827';
      context.lineWidth = mobileMode ? 4.2 : 2.6;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      if (!value) return;
      const image = new Image();
      image.onload = () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      };
      image.src = value;
    };

    resize();

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => resize());
    observer?.observe(frame);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [mobileMode, value]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const point = getPoint(event);
    if (!context || !point) return;
    context.beginPath();
    context.moveTo(point.x, point.y);
    setDrawing(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !drawing) return;
    const context = canvas.getContext('2d');
    const point = getPoint(event);
    if (!context || !point) return;
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const finishDrawing = () => {
    if (!drawing) return;
    setDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL('image/png'));
  };

  const clearPad = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  };

  return (
    <div className={hideHeader ? 'h-full w-full min-w-0' : 'w-full min-w-0 space-y-3'}>
      {!hideHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium">{label}</div>
          <div className="flex flex-wrap gap-2">
            {showClearButton ? (
              <Button type="button" size="sm" variant="outline" onClick={clearPad}>
                {tx('清除', 'Clear')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={frameRef}
        className={`w-full min-w-0 overflow-hidden rounded-xl border bg-white ${mobileMode ? 'h-full min-h-0' : 'h-44'} ${frameClassName}`}
      >
        <div className="flex h-full w-full items-center justify-center">
          <canvas
            ref={canvasRef}
            width={1000}
            height={320}
            className={`touch-none rounded-md bg-transparent ${mobileMode ? 'h-full w-full' : 'block h-full w-full max-w-full'} ${canvasClassName}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrawing}
            onPointerLeave={finishDrawing}
          />
        </div>
      </div>
    </div>
  );
}
