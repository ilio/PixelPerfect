
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Tool, Point, DrawingAction, PastedRegion } from '../types';

interface CanvasEditorProps {
  image: HTMLImageElement;
  tool: Tool;
  color: string;
  lineWidth: number;
  intensity: number;
  history: DrawingAction[];
  setHistory: React.Dispatch<React.SetStateAction<DrawingAction[]>>;
  pastedRegions: PastedRegion[];
  setPastedRegions: React.Dispatch<React.SetStateAction<PastedRegion[]>>;
  onAnalyzeRequest: (canvas: HTMLCanvasElement) => void;
  onToolChange: (tool: Tool) => void;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | 'move' | 'point-0' | 'point-end';

const HANDLE_RADIUS = 8;
const RESIZE_THRESHOLD = 12;

const distSq = (p1: Point, p2: Point) => (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;

const distToSegmentSq = (p: Point, v: Point, w: Point) => {
  const l2 = distSq(v, w);
  if (l2 === 0) return distSq(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return distSq(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
};

const CanvasEditor: React.FC<CanvasEditorProps> = ({ 
  image, tool, color, lineWidth, intensity, history, setHistory, pastedRegions, setPastedRegions, onToolChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tempCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotBufferRef = useRef<HTMLCanvasElement | null>(null);
  const regionCache = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [selection, setSelection] = useState<{ start: Point; end: Point } | null>(null);
  
  const [draggedItem, setDraggedItem] = useState<{ 
    type: 'action' | 'region', 
    index: number, 
    handle: ResizeHandle,
    initialBox?: BoundingBox,
    initialPoints?: Point[],
    initialPosition?: Point
  } | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [hoveredItem, setHoveredItem] = useState<{ type: 'action' | 'region', index: number, handle: ResizeHandle } | null>(null);
  const [hoveredEraserItem, setHoveredEraserItem] = useState<{ type: 'action' | 'region', index: number } | null>(null);
  const [mousePos, setMousePos] = useState<Point | null>(null);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    let clientX: number;
    let clientY: number;

    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    } else if ('changedTouches' in e && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      return { x: 0, y: 0 };
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const getActionBounds = (action: DrawingAction): BoundingBox => {
    const xs = action.points.map(p => p.x);
    const ys = action.points.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };

  const getResizeHandle = (coords: Point, box: BoundingBox): ResizeHandle | 'move' | null => {
    const { x, y, width, height } = box;
    const nearLeft = Math.abs(coords.x - x) < RESIZE_THRESHOLD;
    const nearRight = Math.abs(coords.x - (x + width)) < RESIZE_THRESHOLD;
    const nearTop = Math.abs(coords.y - y) < RESIZE_THRESHOLD;
    const nearBottom = Math.abs(coords.y - (y + height)) < RESIZE_THRESHOLD;
    const withinWidth = coords.x >= x - RESIZE_THRESHOLD && coords.x <= x + width + RESIZE_THRESHOLD;
    const withinHeight = coords.y >= y - RESIZE_THRESHOLD && coords.y <= y + height + RESIZE_THRESHOLD;
    if (nearLeft && nearTop) return 'nw';
    if (nearRight && nearTop) return 'ne';
    if (nearLeft && nearBottom) return 'sw';
    if (nearRight && nearBottom) return 'se';
    if (nearLeft && withinHeight) return 'w';
    if (nearRight && withinHeight) return 'e';
    if (nearTop && withinWidth) return 'n';
    if (nearBottom && withinWidth) return 's';
    if (coords.x >= x && coords.x <= x + width && coords.y >= y && coords.y <= y + height) return 'move';
    return null;
  };

  const getRegionCanvas = (region: PastedRegion) => {
    if (regionCache.current.has(region.id)) return regionCache.current.get(region.id)!;
    const canvas = document.createElement('canvas');
    canvas.width = region.imageData.width;
    canvas.height = region.imageData.height;
    canvas.getContext('2d')?.putImageData(region.imageData, 0, 0);
    regionCache.current.set(region.id, canvas);
    return canvas;
  };

  const applyPath = (ctx: CanvasRenderingContext2D, points: Point[]) => {
    if (points.length < 1) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
  };

  const getScratchCanvas = (width: number, height: number) => {
    if (!scratchCanvasRef.current) {
      scratchCanvasRef.current = document.createElement('canvas');
    }
    const canvas = scratchCanvasRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);
      ctx.restore();
    }
    return canvas;
  };

  const getSnapshotBuffer = (width: number, height: number) => {
    if (!snapshotBufferRef.current) {
      snapshotBufferRef.current = document.createElement('canvas');
    }
    const canvas = snapshotBufferRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return canvas;
  };

  const renderActionToCtx = (ctx: CanvasRenderingContext2D, action: DrawingAction, source: HTMLCanvasElement | HTMLImageElement) => {
    const { tool, points, color, lineWidth, intensity: actionIntensity } = action;
    if (points.length < 1) return;

    const isFilter = tool === Tool.BLUR || tool === Tool.PIXELATE;
    const effectiveWidth = isFilter ? lineWidth * 3.5 : lineWidth;
    const currentIntensity = actionIntensity ?? 40;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = effectiveWidth;

    if (isFilter) {
      const canvasW = source instanceof HTMLImageElement ? source.width : source.width;
      const canvasH = source instanceof HTMLImageElement ? source.height : source.height;
      
      const scratch = getScratchCanvas(canvasW, canvasH);
      const sctx = scratch.getContext('2d');
      if (sctx) {
        sctx.save(); 
        sctx.lineCap = 'round';
        sctx.lineJoin = 'round';
        sctx.lineWidth = effectiveWidth;
        sctx.strokeStyle = 'white';
        sctx.fillStyle = 'white';

        if (points.length === 1) {
          sctx.beginPath();
          sctx.arc(points[0].x, points[0].y, effectiveWidth / 2, 0, Math.PI * 2);
          sctx.fill();
        } else {
          applyPath(sctx, points);
          sctx.stroke();
        }

        sctx.globalCompositeOperation = 'source-in';
        if (tool === Tool.BLUR) {
          const blurAmount = Math.max(1, (currentIntensity / 100) * 40);
          sctx.filter = `blur(${blurAmount}px)`;
          sctx.drawImage(source, 0, 0);
        } else {
          const pixelScale = Math.max(0.005, 0.2 - (currentIntensity / 100) * 0.195);
          const w = Math.ceil(canvasW * pixelScale);
          const h = Math.ceil(canvasH * pixelScale);
          const mini = document.createElement('canvas');
          mini.width = Math.max(1, w);
          mini.height = Math.max(1, h);
          const mctx = mini.getContext('2d');
          if (mctx) {
            mctx.imageSmoothingEnabled = false;
            mctx.drawImage(source, 0, 0, mini.width, mini.height);
            sctx.imageSmoothingEnabled = false;
            sctx.drawImage(mini, 0, 0, mini.width, mini.height, 0, 0, canvasW, canvasH);
          }
        }
        sctx.restore();
        ctx.drawImage(scratch, 0, 0);
      }
    } else {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (tool === Tool.LINE) {
        if (points.length === 1) {
          ctx.beginPath();
          ctx.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          applyPath(ctx, points);
          ctx.stroke();
        }
      } else if (tool === Tool.ARROW && points.length >= 2) {
        drawArrow(ctx, points[0].x, points[0].y, points[points.length - 1].x, points[points.length - 1].y, effectiveWidth);
      } else if (tool === Tool.RECTANGLE && points.length >= 2) {
        const start = points[0];
        const end = points[points.length - 1];
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      }
    }
    ctx.restore();
  };

  const drawArrow = (ctx: CanvasRenderingContext2D, fromx: number, fromy: number, tox: number, toy: number, weight: number) => {
    const dx = tox - fromx;
    const dy = toy - fromy;
    const angle = Math.atan2(dy, dx);
    const headLen = Math.max(weight * 4.5, 20);
    const headWidthAngle = Math.PI / 6.5; 
    const x1 = tox - headLen * Math.cos(angle - headWidthAngle);
    const y1 = toy - headLen * Math.sin(angle - headWidthAngle);
    const x2 = tox - headLen * Math.cos(angle + headWidthAngle);
    const y2 = toy - headLen * Math.sin(angle + headWidthAngle);
    const indentPointX = tox - (headLen * 0.75) * Math.cos(angle);
    const indentPointY = toy - (headLen * 0.75) * Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(fromx, fromy);
    ctx.lineTo(indentPointX, indentPointY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tox, toy);
    ctx.lineTo(x1, y1);
    ctx.lineTo(indentPointX, indentPointY);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fill();
  };

  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Reset and draw base original image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);

    // Combine and Sort Edits Chronologically
    const edits = [
      ...history.map((a, i) => ({ ...a, type: 'action' as const, originalIndex: i })),
      ...pastedRegions.map((r, i) => ({ ...r, type: 'region' as const, originalIndex: i }))
    ].sort((a, b) => a.id.localeCompare(b.id));

    // Sequential Rendering
    edits.forEach((edit) => {
      const isThisDragged = draggedItem?.type === edit.type && draggedItem.index === edit.originalIndex;
      const isThisHoveredSelect = tool === Tool.SELECT && hoveredItem?.type === edit.type && hoveredItem.index === edit.originalIndex;
      const isThisHoveredEraser = tool === Tool.ERASER && hoveredEraserItem?.type === edit.type && hoveredEraserItem.index === edit.originalIndex;

      const needsFeedback = isThisDragged || isThisHoveredSelect || isThisHoveredEraser;

      if (needsFeedback) {
        ctx.save();
        // Feedback Styles
        if (isThisHoveredEraser) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#ef4444'; // Red glow for deletion
        } else if (isThisDragged) {
          ctx.shadowBlur = 20;
          ctx.shadowColor = '#3b82f6'; // Blue glow for dragging
          ctx.shadowOffsetX = 5;
          ctx.shadowOffsetY = 5;
        } else if (isThisHoveredSelect) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = '#3b82f6'; // Blue glow for selection
        }
      }

      if (edit.type === 'action') {
        const isFilter = edit.tool === Tool.BLUR || edit.tool === Tool.PIXELATE;
        let source: HTMLCanvasElement | HTMLImageElement = image;
        if (isFilter) {
          const snapshot = getSnapshotBuffer(canvas.width, canvas.height);
          snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
          source = snapshot;
        }
        renderActionToCtx(ctx, edit, source);
      } else {
        const rCanvas = getRegionCanvas(edit);
        ctx.drawImage(rCanvas, edit.position.x, edit.position.y, edit.width, edit.height);
      }

      if (needsFeedback) {
        ctx.restore();
      }
    });

    // Drawing Preview (Active Stroke)
    if (isDrawing && currentPoints.length >= 1 && tool !== Tool.SELECT && tool !== Tool.ERASER && tool !== Tool.COPY_REGION) {
      const isFilter = tool === Tool.BLUR || tool === Tool.PIXELATE;
      let source: HTMLCanvasElement | HTMLImageElement = image;
      if (isFilter) {
        const snapshot = getSnapshotBuffer(canvas.width, canvas.height);
        snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
        source = snapshot;
      }
      renderActionToCtx(ctx, { id: 'preview', tool, points: currentPoints, color, lineWidth, intensity }, source);
    }

    // Overlays (Selections & Hover Indicators)
    const getPadding = (itemWidth: number) => Math.max(8, (itemWidth / 2) + 6);

    edits.forEach((edit) => {
      if (edit.type === 'region') {
        const isHoveredSelect = tool === Tool.SELECT && hoveredItem?.type === 'region' && hoveredItem.index === edit.originalIndex;
        const isHoveredEraser = tool === Tool.ERASER && hoveredEraserItem?.type === 'region' && hoveredEraserItem.index === edit.originalIndex;
        
        if (isHoveredSelect || isHoveredEraser) {
          ctx.save();
          ctx.strokeStyle = isHoveredEraser ? '#ef4444' : '#3b82f6';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 2;
          const pad = 8;
          ctx.strokeRect(edit.position.x - pad, edit.position.y - pad, edit.width + pad * 2, edit.height + pad * 2);
          ctx.restore();
        }
      } else if (edit.type === 'action') {
        const isHoveredSelect = tool === Tool.SELECT && hoveredItem?.type === 'action' && hoveredItem.index === edit.originalIndex;
        const isHoveredEraser = tool === Tool.ERASER && hoveredEraserItem?.type === 'action' && hoveredEraserItem.index === edit.originalIndex;
        
        if (isHoveredSelect) {
          const box = getActionBounds(edit);
          const pad = getPadding(edit.lineWidth);
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
          
          if (edit.tool === Tool.ARROW) {
            const drawPointHandle = (p: Point, active: boolean) => {
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
              ctx.fillStyle = active ? '#3b82f6' : 'white';
              ctx.fill();
              ctx.strokeStyle = '#3b82f6';
              ctx.stroke();
            };
            drawPointHandle(edit.points[0], hoveredItem?.handle === 'point-0');
            drawPointHandle(edit.points[edit.points.length - 1], hoveredItem?.handle === 'point-end');
          }
          ctx.restore();
        } else if (isHoveredEraser) {
          const box = getActionBounds(edit);
          const pad = getPadding(edit.lineWidth);
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
          ctx.restore();
        }
      }
    });
  }, [image, history, pastedRegions, tool, hoveredItem, hoveredEraserItem, isDrawing, currentPoints, color, lineWidth, intensity, draggedItem]);

  useEffect(() => {
    if (canvasRef.current && image) {
      canvasRef.current.width = image.width;
      canvasRef.current.height = image.height;
      if (tempCanvasRef.current) {
        tempCanvasRef.current.width = image.width;
        tempCanvasRef.current.height = image.height;
      }
      drawAll();
    }
  }, [image, drawAll]);

  const findEraserTargetAt = useCallback((coords: Point) => {
    const eraserRadiusSq = (lineWidth * 2) ** 2;
    
    const allEdits = [
      ...history.map((a, i) => ({ ...a, type: 'action' as const, originalIndex: i })),
      ...pastedRegions.map((r, i) => ({ ...r, type: 'region' as const, originalIndex: i }))
    ].sort((a, b) => b.id.localeCompare(a.id));

    for (const edit of allEdits) {
      if (edit.type === 'action') {
        let isHit = false;
        if (edit.tool === Tool.LINE || edit.tool === Tool.BLUR || edit.tool === Tool.PIXELATE) {
          if (edit.points.length === 1) {
            if (distSq(coords, edit.points[0]) < eraserRadiusSq) isHit = true;
          } else {
            for (let j = 0; j < edit.points.length - 1; j++) {
              if (distToSegmentSq(coords, edit.points[j], edit.points[j+1]) < eraserRadiusSq) {
                isHit = true; break;
              }
            }
          }
        } else if (edit.tool === Tool.ARROW) {
          if (distToSegmentSq(coords, edit.points[0], edit.points[edit.points.length - 1]) < eraserRadiusSq) isHit = true;
        } else if (edit.tool === Tool.RECTANGLE) {
          const s = edit.points[0]; const e = edit.points[edit.points.length-1];
          const sides = [{a:s,b:{x:e.x,y:s.y}}, {a:{x:e.x,y:s.y},b:e}, {a:e,b:{x:s.x,y:e.y}}, {a:{x:s.x,y:e.y},b:s}];
          if (sides.some(side => distToSegmentSq(coords, side.a, side.b) < eraserRadiusSq)) isHit = true;
        }
        if (isHit) return { type: 'action' as const, index: edit.originalIndex };
      } else {
        if (coords.x >= edit.position.x && coords.x <= edit.position.x + edit.width && coords.y >= edit.position.y && coords.y <= edit.position.y + edit.height) {
          return { type: 'region' as const, index: edit.originalIndex };
        }
      }
    }
    return null;
  }, [history, pastedRegions, lineWidth]);

  const handleErasing = useCallback((coords: Point) => {
    const target = findEraserTargetAt(coords);
    if (!target) return;
    if (target.type === 'action') {
      setHistory(prev => prev.filter((_, i) => i !== target.index));
    } else {
      setPastedRegions(prev => prev.filter((_, i) => i !== target.index));
    }
    setHoveredEraserItem(null); 
  }, [findEraserTargetAt, setHistory, setPastedRegions]);

  const findItemAt = useCallback((coords: Point) => {
    const allEdits = [
      ...history.map((a, i) => ({ ...a, type: 'action' as const, originalIndex: i })),
      ...pastedRegions.map((r, i) => ({ ...r, type: 'region' as const, originalIndex: i }))
    ].sort((a, b) => b.id.localeCompare(a.id));

    for (const edit of allEdits) {
      if (edit.type === 'region') {
        const box = { x: edit.position.x, y: edit.position.y, width: edit.width, height: edit.height };
        const handle = getResizeHandle(coords, box);
        if (handle) return { type: 'region' as const, index: edit.originalIndex, handle };
      } else {
        if (edit.tool === Tool.ARROW) {
          if (distSq(coords, edit.points[0]) < (HANDLE_RADIUS + 10) ** 2) return { type: 'action' as const, index: edit.originalIndex, handle: 'point-0' as const };
          if (distSq(coords, edit.points[edit.points.length - 1]) < (HANDLE_RADIUS + 10) ** 2) return { type: 'action' as const, index: edit.originalIndex, handle: 'point-end' as const };
        }
        const box = getActionBounds(edit);
        const handle = getResizeHandle(coords, box);
        if (handle) return { type: 'action' as const, index: edit.originalIndex, handle };
      }
    }
    return null;
  }, [pastedRegions, history]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    
    if (tool === Tool.COPY_REGION && selection) {
      const canvas = canvasRef.current;
      if (canvas) {
        const x = Math.round(Math.min(selection.start.x, selection.end.x));
        const y = Math.round(Math.min(selection.start.y, selection.end.y));
        const w = Math.round(Math.abs(selection.start.x - selection.end.x));
        const h = Math.round(Math.abs(selection.start.y - selection.end.y));
        if (w > 0 && h > 0) {
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            const imageData = ctx.getImageData(x, y, w, h);
            const newRegion: PastedRegion = { id: Date.now().toString(), imageData, position: { x: x + 10, y: y + 10 }, width: w, height: h };
            setPastedRegions(prev => [...prev, newRegion]);
            onToolChange(Tool.SELECT);
          }
        }
      }
      setSelection(null);
    } else if (tool !== Tool.SELECT && tool !== Tool.ERASER && currentPoints.length >= 1) {
      const isShape = tool === Tool.ARROW || tool === Tool.RECTANGLE;
      if (!isShape || currentPoints.length >= 2) {
        setHistory(prev => [...prev, { id: Date.now().toString(), tool, points: currentPoints, color, lineWidth, intensity }]);
      }
    }
    
    setIsDrawing(false);
    setDraggedItem(null);
    setCurrentPoints([]);
    
    const tctx = tempCanvasRef.current?.getContext('2d');
    if (tctx) tctx.clearRect(0, 0, tctx.canvas.width, tctx.canvas.height);
    drawAll();
  }, [isDrawing, tool, selection, currentPoints, color, lineWidth, intensity, setHistory, setPastedRegions, onToolChange, drawAll]);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const coords = getCoordinates(e);
    setIsDrawing(true);
    setCurrentPoints([coords]);
    setMousePos(coords);

    if (tool === Tool.SELECT) {
      const item = findItemAt(coords);
      if (item) {
        const initialBox = item.type === 'region' 
          ? { x: pastedRegions[item.index].position.x, y: pastedRegions[item.index].position.y, width: pastedRegions[item.index].width, height: pastedRegions[item.index].height }
          : getActionBounds(history[item.index]);
        setDraggedItem({ 
          ...item, initialBox, 
          initialPoints: item.type === 'action' ? history[item.index].points : undefined,
          initialPosition: item.type === 'region' ? pastedRegions[item.index].position : undefined
        });
        setDragOffset({ x: coords.x, y: coords.y });
      }
    } else if (tool === Tool.ERASER) {
      handleErasing(coords);
    } else if (tool === Tool.COPY_REGION) {
      setSelection({ start: coords, end: coords });
    }
  };

  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    const coords = getCoordinates(e);
    setMousePos(coords);
    
    const tctx = tempCanvasRef.current?.getContext('2d');
    if (tctx) {
      tctx.clearRect(0, 0, tctx.canvas.width, tctx.canvas.height);
      
      // Tool Preview Markers
      if (tool === Tool.ERASER) {
        tctx.beginPath();
        tctx.arc(coords.x, coords.y, lineWidth * 1.5, 0, Math.PI * 2);
        tctx.strokeStyle = '#ef4444';
        tctx.lineWidth = 2;
        tctx.stroke();
        tctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
        tctx.fill();
        
        if (isDrawing) {
          handleErasing(coords);
        } else {
          const target = findEraserTargetAt(coords);
          if (target?.index !== hoveredEraserItem?.index || target?.type !== hoveredEraserItem?.type) {
            setHoveredEraserItem(target);
          }
        }
      } else if (tool === Tool.BLUR || tool === Tool.PIXELATE) {
        const effectiveRadius = (lineWidth * 3.5) / 2;
        tctx.beginPath();
        tctx.arc(coords.x, coords.y, effectiveRadius, 0, Math.PI * 2);
        tctx.strokeStyle = tool === Tool.BLUR ? 'rgba(59, 130, 246, 0.8)' : 'rgba(34, 197, 94, 0.8)';
        tctx.lineWidth = 2;
        tctx.stroke();
      } else if (tool === Tool.LINE) {
        const radius = lineWidth / 2;
        tctx.beginPath();
        tctx.arc(coords.x, coords.y, radius, 0, Math.PI * 2);
        tctx.strokeStyle = color;
        tctx.lineWidth = 1.5;
        tctx.stroke();
      }

      if (tool === Tool.COPY_REGION && isDrawing && selection) {
        const x = Math.min(selection.start.x, coords.x);
        const y = Math.min(selection.start.y, coords.y);
        const w = Math.abs(selection.start.x - coords.x);
        const h = Math.abs(selection.start.y - coords.y);
        tctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        tctx.fillRect(x, y, w, h);
        tctx.strokeStyle = '#3b82f6';
        tctx.setLineDash([5, 5]);
        tctx.strokeRect(x, y, w, h);
      }
    }

    if (!isDrawing) {
      if (tool === Tool.SELECT) {
        setHoveredItem(findItemAt(coords));
      }
      return;
    }
    
    if (tool === Tool.SELECT && draggedItem) {
      const { initialBox, initialPoints, handle } = draggedItem;
      if (!initialBox) return;
      const dx = coords.x - dragOffset.x;
      const dy = coords.y - dragOffset.y;
      let newBox = { ...initialBox };

      if (handle === 'move') {
        newBox.x = initialBox.x + dx;
        newBox.y = initialBox.y + dy;
      } else if (handle !== 'point-0' && handle !== 'point-end') {
        if (handle.includes('e')) newBox.width = Math.max(10, initialBox.width + dx);
        if (handle.includes('w')) {
          const w = Math.max(10, initialBox.width - dx);
          newBox.x = initialBox.x + (initialBox.width - w); newBox.width = w;
        }
        if (handle.includes('s')) newBox.height = Math.max(10, initialBox.height + dy);
        if (handle.includes('n')) {
          const h = Math.max(10, initialBox.height - dy);
          newBox.y = initialBox.y + (initialBox.height - h); newBox.height = h;
        }
      }

      if (draggedItem.type === 'region') {
        setPastedRegions(prev => prev.map((r, i) => i === draggedItem.index ? { ...r, position: { x: newBox.x, y: newBox.y }, width: newBox.width, height: newBox.height } : r));
      } else {
        setHistory(prev => prev.map((a, i) => {
          if (i !== draggedItem.index) return a;
          const currentInitialPoints = initialPoints || a.points;
          if (handle === 'point-0') {
            const newPoints = [...currentInitialPoints]; newPoints[0] = coords; return { ...a, points: newPoints };
          } else if (handle === 'point-end') {
            const newPoints = [...currentInitialPoints]; newPoints[newPoints.length - 1] = coords; return { ...a, points: newPoints };
          } else if (handle === 'move') {
            return { ...a, points: currentInitialPoints.map(p => ({ x: p.x + dx, y: p.y + dy })) };
          } else {
            const scaleX = newBox.width / initialBox.width;
            const scaleY = newBox.height / initialBox.height;
            return { ...a, points: currentInitialPoints.map(p => ({ x: newBox.x + (p.x - initialBox.x) * scaleX, y: newBox.y + (p.y - initialBox.y) * scaleY }))};
          }
        }));
      }
    } else if (tool === Tool.COPY_REGION) {
      setSelection(prev => prev ? { ...prev, end: coords } : null);
    } else if (tool !== Tool.ERASER) {
      const isFreehand = tool === Tool.LINE || tool === Tool.BLUR || tool === Tool.PIXELATE;
      setCurrentPoints(prev => isFreehand ? [...prev, coords] : [prev[0], coords]);
    }
  }, [isDrawing, tool, selection, draggedItem, dragOffset, findItemAt, findEraserTargetAt, handleErasing, lineWidth, color, hoveredEraserItem, pastedRegions, history, setPastedRegions, setHistory]);

  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      if (isDrawing) {
        handlePointerMove(e);
      }
    };
    const handleGlobalUp = () => {
      if (isDrawing) {
        stopDrawing();
      }
    };

    window.addEventListener('mousemove', handleGlobalMove);
    window.addEventListener('touchmove', handleGlobalMove, { passive: false });
    window.addEventListener('mouseup', handleGlobalUp);
    window.addEventListener('touchend', handleGlobalUp);
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('touchmove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchend', handleGlobalUp);
    };
  }, [isDrawing, handlePointerMove, stopDrawing]);

  const getCursor = () => {
    if (tool === Tool.ERASER || tool === Tool.BLUR || tool === Tool.PIXELATE || tool === Tool.LINE) return 'cursor-none';
    if (tool !== Tool.SELECT) return 'cursor-crosshair';
    if (!hoveredItem) return 'cursor-default';
    switch (hoveredItem.handle) {
      case 'nw': case 'se': return 'cursor-nwse-resize';
      case 'ne': case 'sw': return 'cursor-nesw-resize';
      case 'n': case 's': return 'cursor-ns-resize';
      case 'e': case 'w': return 'cursor-ew-resize';
      case 'point-0': case 'point-end': return 'cursor-pointer';
      case 'move': return 'cursor-move';
      default: return 'cursor-default';
    }
  };

  return (
    <div className="relative inline-block shadow-2xl rounded-sm overflow-hidden bg-zinc-900 border border-zinc-800">
      <canvas ref={canvasRef} className="block max-w-full max-h-[80vh] object-contain" />
      <canvas 
        ref={tempCanvasRef}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={stopDrawing}
        onMouseLeave={() => { setHoveredEraserItem(null); setHoveredItem(null); setMousePos(null); }}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={stopDrawing}
        className={`absolute top-0 left-0 w-full h-full z-10 touch-none ${getCursor()}`}
      />
    </div>
  );
};

export default CanvasEditor;
