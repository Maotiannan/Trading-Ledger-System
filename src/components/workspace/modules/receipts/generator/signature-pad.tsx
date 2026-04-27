'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type SignaturePadProps = {
  label: string;
  tx: (zh: string, en: string) => string;
  value: string | null;
  onChange: (value: string | null) => void;
  mobileMode?: boolean;
};

export function SignaturePad({
  label,
  tx,
  value,
  onChange,
  mobileMode = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [rotation, setRotation] = useState<0 | 90 | -90>(0);

  const displayClassName = useMemo(() => {
    if (rotation === 90) return 'rotate-90';
    if (rotation === -90) return '-rotate-90';
    return '';
  }, [rotation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#111827';
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (!value) return;
    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = value;
  }, [value]);

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
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{label}</div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={rotation === -90 ? 'default' : 'outline'} onClick={() => setRotation(-90)}>
            {tx('左转 90°', 'Rotate -90°')}
          </Button>
          <Button type="button" size="sm" variant={rotation === 0 ? 'default' : 'outline'} onClick={() => setRotation(0)}>
            {tx('正向', 'Normal')}
          </Button>
          <Button type="button" size="sm" variant={rotation === 90 ? 'default' : 'outline'} onClick={() => setRotation(90)}>
            {tx('右转 90°', 'Rotate +90°')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={clearPad}>
            {tx('清除', 'Clear')}
          </Button>
        </div>
      </div>

      <div className={`overflow-hidden rounded-xl border bg-white ${mobileMode ? 'h-[44vh]' : 'h-64'}`}>
        <div className={`flex h-full w-full items-center justify-center transition-transform ${displayClassName}`}>
          <canvas
            ref={canvasRef}
            width={1000}
            height={320}
            className={`touch-none rounded-md bg-white ${mobileMode ? 'h-[36vh] w-[92vw]' : 'h-56 w-full'}`}
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
