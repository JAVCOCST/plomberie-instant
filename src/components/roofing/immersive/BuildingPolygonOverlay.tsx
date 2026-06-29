import React, { useEffect, useRef, useCallback } from 'react';

interface BuildingPolygonOverlayProps {
  geojson: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  imgSize: number;
  scale?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

function latLngToPixel(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  zoom: number,
  imgSize: number,
  scale: number
): { x: number; y: number } {
  const tileSize = 256;
  const totalPixels = tileSize * Math.pow(2, zoom) * scale;

  const lngToX = (l: number) => ((l + 180) / 360) * totalPixels;
  const latToY = (l: number) => {
    const sinLat = Math.sin((l * Math.PI) / 180);
    return ((0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * totalPixels);
  };

  const centerX = lngToX(centerLng);
  const centerY = latToY(centerLat);
  const pointX = lngToX(lng);
  const pointY = latToY(lat);

  const halfImg = imgSize / 2;

  return {
    x: halfImg + (pointX - centerX) / scale,
    y: halfImg + (pointY - centerY) / scale,
  };
}

const BuildingPolygonOverlay: React.FC<BuildingPolygonOverlayProps> = ({
  geojson,
  centerLat,
  centerLng,
  zoom,
  imgSize,
  scale = 2,
  fillColor = 'hsla(35, 100%, 55%, 0.25)',
  strokeColor = 'hsla(35, 100%, 55%, 0.9)',
  strokeWidth = 2,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, imgSize, imgSize);

    let parsed: any;
    try {
      parsed = JSON.parse(geojson);
    } catch {
      return;
    }

    let rings: number[][][] = [];
    if (parsed.type === 'Polygon') {
      rings = parsed.coordinates;
    } else if (parsed.type === 'MultiPolygon') {
      parsed.coordinates.forEach((poly: number[][][]) => {
        rings.push(...poly);
      });
    }

    if (rings.length === 0) return;

    rings.forEach((ring) => {
      const pixels = ring.map(([lng, lat]) =>
        latLngToPixel(lat, lng, centerLat, centerLng, zoom, imgSize, scale)
      );

      if (pixels.length < 3) return;

      ctx.beginPath();
      ctx.moveTo(pixels[0].x, pixels[0].y);
      for (let i = 1; i < pixels.length; i++) {
        ctx.lineTo(pixels[i].x, pixels[i].y);
      }
      ctx.closePath();

      ctx.fillStyle = fillColor;
      ctx.fill();

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    });
  }, [geojson, centerLat, centerLng, zoom, imgSize, scale, fillColor, strokeColor, strokeWidth]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={imgSize}
      height={imgSize}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  );
};

export default BuildingPolygonOverlay;
