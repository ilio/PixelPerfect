
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Pencil, 
  ArrowUpRight, 
  Square, 
  MousePointer2, 
  Copy, 
  Clipboard, 
  Trash2, 
  Download, 
  Upload, 
  Undo,
  Sparkles,
  Camera,
  Layers,
  Ghost,
  Grid3X3,
  Eraser as EraserIcon,
  SlidersHorizontal
} from 'lucide-react';
import { Tool, Point, DrawingAction, PastedRegion } from './types';
import CanvasEditor from './components/CanvasEditor';
import { analyzeImage } from './services/gemini';

const App: React.FC = () => {
  const [activeTool, setActiveTool] = useState<Tool>(Tool.ARROW);
  const [color, setColor] = useState('#c4213a'); 
  const [lineWidth, setLineWidth] = useState(8); 
  const [intensity, setIntensity] = useState(40); // 1-100 scale for blur/pixelate
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [history, setHistory] = useState<DrawingAction[]>([]);
  const [pastedRegions, setPastedRegions] = useState<PastedRegion[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadImage = useCallback((src: string) => {
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setHistory([]);
      setPastedRegions([]);
      setAnalysisResult(null);
    };
    img.src = src;
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          loadImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              loadImage(event.target.result as string);
            }
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  }, [loadImage]);

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const handleGeminiAnalysis = async (canvas: HTMLCanvasElement) => {
    setIsAnalyzing(true);
    setAnalysisResult(null);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      const result = await analyzeImage(base64);
      setAnalysisResult(result);
    } catch (error) {
      console.error("Analysis failed", error);
      setAnalysisResult("Failed to analyze image. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUndo = () => {
    const lastHistory = history[history.length - 1];
    const lastRegion = pastedRegions[pastedRegions.length - 1];

    if (!lastHistory && !lastRegion) return;

    if (!lastHistory) {
      setPastedRegions(prev => prev.slice(0, -1));
    } else if (!lastRegion) {
      setHistory(prev => prev.slice(0, -1));
    } else {
      // Compare IDs (which are timestamps) to find the absolute last item
      if (lastHistory.id > lastRegion.id) {
        setHistory(prev => prev.slice(0, -1));
      } else {
        setPastedRegions(prev => prev.slice(0, -1));
      }
    }
  };

  const clearCanvas = () => {
    if (window.confirm("Are you sure you want to clear all edits?")) {
      setHistory([]);
      setPastedRegions([]);
      setAnalysisResult(null);
    }
  };

  const showIntensitySlider = activeTool === Tool.BLUR || activeTool === Tool.PIXELATE;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#c4213a] rounded-xl flex items-center justify-center shadow-lg shadow-red-900/40">
            <Camera className="text-white" size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight hidden sm:block">PixelPerfect</h1>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
            title="Upload Image"
          >
            <Upload size={20} />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImageUpload} 
            className="hidden" 
            accept="image/*"
          />
          <button 
            onClick={handleUndo}
            className="p-2.5 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo"
            disabled={history.length === 0 && pastedRegions.length === 0}
          >
            <Undo size={20} />
          </button>
          <button 
            onClick={clearCanvas}
            className="p-2.5 rounded-lg hover:bg-zinc-800 transition-colors text-red-500 hover:text-red-400"
            title="Clear All"
          >
            <Trash2 size={20} />
          </button>
          <div className="w-px h-6 bg-zinc-800 mx-2" />
          <button 
            onClick={() => {
              const canvas = document.querySelector('canvas');
              if (canvas) {
                const link = document.createElement('a');
                link.download = 'pixelperfect-edit.png';
                link.href = canvas.toDataURL();
                link.click();
              }
            }}
            className="flex items-center gap-2 bg-[#c4213a] hover:bg-[#d92641] text-white px-4 py-2 rounded-lg font-medium transition-all shadow-lg shadow-red-900/20"
          >
            <Download size={18} />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Left Toolbar */}
        <aside className="w-full md:w-20 bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-row md:flex-col items-center py-4 px-2 gap-4 z-40 overflow-x-auto md:overflow-x-visible">
          <ToolButton active={activeTool === Tool.SELECT} onClick={() => setActiveTool(Tool.SELECT)} icon={<MousePointer2 size={24} />} label="Select" />
          <ToolButton active={activeTool === Tool.LINE} onClick={() => setActiveTool(Tool.LINE)} icon={<Pencil size={24} />} label="Pencil" />
          <ToolButton active={activeTool === Tool.ARROW} onClick={() => setActiveTool(Tool.ARROW)} icon={<ArrowUpRight size={24} />} label="Arrow" />
          <ToolButton active={activeTool === Tool.RECTANGLE} onClick={() => setActiveTool(Tool.RECTANGLE)} icon={<Square size={24} />} label="Box" />
          
          <div className="w-full h-px bg-zinc-800 hidden md:block" />
          
          <ToolButton active={activeTool === Tool.BLUR} onClick={() => setActiveTool(Tool.BLUR)} icon={<Ghost size={24} />} label="Blur Brush" />
          <ToolButton active={activeTool === Tool.PIXELATE} onClick={() => setActiveTool(Tool.PIXELATE)} icon={<Grid3X3 size={24} />} label="Pixelate Brush" />
          <ToolButton active={activeTool === Tool.ERASER} onClick={() => setActiveTool(Tool.ERASER)} icon={<EraserIcon size={24} />} label="Eraser" />
          
          <div className="w-full h-px bg-zinc-800 hidden md:block" />
          
          <ToolButton active={activeTool === Tool.COPY_REGION} onClick={() => setActiveTool(Tool.COPY_REGION)} icon={<Copy size={24} />} label="Copy Region" />
          
          <div className="flex-1" />
          
          <div className="flex flex-col gap-4 items-center pb-4 w-full px-2">
            {showIntensitySlider && (
              <div className="relative group flex flex-col items-center gap-1">
                <SlidersHorizontal size={18} className="text-zinc-500 group-hover:text-white transition-colors" />
                <div className="w-10 h-1 bg-zinc-700 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-full" style={{ width: `${intensity}%` }} />
                </div>
                <input 
                  type="range" 
                  min="5" 
                  max="100" 
                  value={intensity} 
                  onChange={(e) => setIntensity(Number(e.target.value))}
                  className="absolute -top-10 left-0 w-24 -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity z-50 cursor-pointer"
                  title="Effect Intensity"
                />
              </div>
            )}

            <input 
              type="color" 
              value={color} 
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-10 rounded-full border-none cursor-pointer bg-transparent"
              title="Color"
            />

            <div className="relative group flex flex-col items-center gap-1">
              <div className="w-10 h-1 text-center bg-zinc-700 rounded-full overflow-hidden">
                <div className="bg-[#c4213a] h-full" style={{ width: `${(lineWidth / 40) * 100}%` }} />
              </div>
              <input 
                type="range" 
                min="1" 
                max="40" 
                value={lineWidth} 
                onChange={(e) => setLineWidth(Number(e.target.value))}
                className="absolute -top-10 left-0 w-24 -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity z-50 cursor-pointer"
                title="Brush Size"
              />
            </div>
          </div>
        </aside>

        {/* Editor Area */}
        <div className="flex-1 relative bg-zinc-950 overflow-auto p-4 md:p-12 flex items-center justify-center">
          {!image ? (
            <div className="flex flex-col items-center text-center max-w-sm">
              <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center mb-6 border border-zinc-800 animate-pulse">
                <Upload className="text-zinc-600" size={32} />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Ready to edit?</h2>
              <p className="text-zinc-500 mb-8">Upload an image or <span className="text-zinc-300 font-bold">paste (Ctrl+V)</span> from your clipboard to start editing.</p>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-8 py-3 bg-zinc-100 text-zinc-950 font-bold rounded-2xl hover:bg-white transition-colors"
              >
                Choose Image
              </button>
            </div>
          ) : (
            <CanvasEditor 
              image={image}
              tool={activeTool}
              color={color}
              lineWidth={lineWidth}
              intensity={intensity}
              history={history}
              setHistory={setHistory}
              pastedRegions={pastedRegions}
              setPastedRegions={setPastedRegions}
              onAnalyzeRequest={handleGeminiAnalysis}
              onToolChange={setActiveTool}
            />
          )}

          {/* AI FAB */}
          {image && (
            <button 
              onClick={() => {
                const canvas = document.querySelector('canvas');
                if (canvas) handleGeminiAnalysis(canvas);
              }}
              disabled={isAnalyzing}
              className={`fixed bottom-8 right-8 flex items-center gap-3 px-6 py-4 rounded-full font-bold shadow-2xl transition-all z-50 ${isAnalyzing ? 'bg-zinc-800 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white scale-100 hover:scale-105 active:scale-95'}`}
            >
              {isAnalyzing ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <Sparkles size={20} />
              )}
              {isAnalyzing ? 'Analyzing...' : 'AI Insights'}
            </button>
          )}

          {/* AI Result Overlay */}
          {analysisResult && (
            <div className="fixed top-20 right-8 w-80 max-h-[70vh] bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl p-6 z-50 animate-in slide-in-from-right overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold flex items-center gap-2 text-indigo-400">
                  <Sparkles size={16} />
                  Gemini Analysis
                </h3>
                <button onClick={() => setAnalysisResult(null)} className="text-zinc-500 hover:text-white">
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {analysisResult}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const ToolButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button 
    onClick={onClick}
    className={`w-12 h-12 flex-shrink-0 flex items-center justify-center rounded-xl transition-all relative group ${active ? 'bg-[#c4213a] text-white shadow-lg shadow-red-900/30' : 'bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
    title={label}
  >
    {icon}
    <span className="absolute left-16 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
      {label}
    </span>
  </button>
);

export default App;
