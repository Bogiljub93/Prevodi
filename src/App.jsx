import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, Image as ImageIcon, Languages, Sparkles, RefreshCw, 
  Download, Settings, Copy, Check, Info, FileText, Sliders
} from 'lucide-react';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SAMPLES = [
  {
    name: 'Bistro Menu (Japanese)',
    lang: 'Japanese to English',
    url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Street Sign (German)',
    lang: 'German to English',
    url: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Product Label (French)',
    lang: 'French to English',
    url: 'https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=800&q=80',
  }
];

const LANGUAGES = [
  { code: 'sr', name: 'Serbian' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ru', name: 'Russian' }
];

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [targetLang, setTargetLang] = useState('Serbian');
  const [selectedImage, setSelectedImage] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedImageUrl, setTranslatedImageUrl] = useState(null);
  const [ocrResults, setOcrResults] = useState([]);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const canvasRef = useRef(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '';
    if (savedKey) setApiKey(savedKey);
  }, []);

  const handleSaveApiKey = (key) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
    setShowSettings(false);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setSelectedImage(reader.result);
        setTranslatedImageUrl(null);
        setOcrResults([]);
        setErrorMsg('');
      };
      reader.readAsDataURL(file);
    }
  };

  const selectSample = (sampleUrl) => {
    setSelectedImage(sampleUrl);
    setTranslatedImageUrl(null);
    setOcrResults([]);
    setErrorMsg('');
  };

  // Funkcija za iscrtavanje izmenjene slike na Canvas-u sa prevedenim tekstom
  const renderTranslatedCanvas = (imgSrc, regions) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imgSrc;
    img.onload = () => {
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      // 1. Nacrtaj originalnu sliku
      ctx.drawImage(img, 0, 0);

      // 2. Prekrij i iscrtaj tekst za svaku detektovanu regiju
      regions.forEach((item) => {
        if (item.box && item.box.length === 4) {
          const [ymin, xmin, ymax, xmax] = item.box;
          const x = (xmin / 1000) * canvas.width;
          const y = (ymin / 1000) * canvas.height;
          const w = ((xmax - xmin) / 1000) * canvas.width;
          const h = ((ymax - ymin) / 1000) * canvas.height;

          // Popuni pozadinu gde je bio stari tekst
          ctx.fillStyle = item.bgColor || 'rgba(0, 0, 0, 0.75)';
          ctx.fillRect(x - 2, y - 2, w + 4, h + 4);

          // Iscrtaj nov tekst
          ctx.fillStyle = item.textColor || '#ffffff';
          const fontSize = Math.max(12, Math.floor(h * 0.7));
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.fillText(item.translatedText, x + 4, y + h / 2, w - 8);
        }
      });

      // Generiši sliku za preuzimanje
      setTranslatedImageUrl(canvas.toDataURL('image/png'));
    };
  };

  const processTranslation = async () => {
    if (!selectedImage) return;

    const keyToUse = apiKey || import.meta.env.VITE_GEMINI_API_KEY;
    if (!keyToUse) {
      setShowSettings(true);
      setErrorMsg('Molimo unesite Google Gemini API ključ.');
      return;
    }

    setIsTranslating(true);
    setErrorMsg('');

    try {
      const genAI = new GoogleGenerativeAI(keyToUse);

      let base64Data = selectedImage;
      let mimeType = 'image/jpeg';
      if (selectedImage.startsWith('data:')) {
        const parts = selectedImage.split(',');
        mimeType = parts[0].match(/:(.*?);/)[1];
        base64Data = parts[1];
      } else {
        const resp = await fetch(selectedImage);
        const blob = await resp.blob();
        mimeType = blob.type;
        base64Data = await new Promise((resolve) => {
          const r = new FileReader();
          r.onloadend = () => resolve(r.result.split(',')[1]);
          r.readAsDataURL(blob);
        });
      }

      const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });

      const ocrPrompt = `Extract all text regions from this image for image-to-image translation.
      For each text region, detect:
      1. originalText: text detected in original image
      2. translatedText: translated text into ${targetLang}
      3. box: bounding box normalized 0 to 1000 as array [ymin, xmin, ymax, xmax]
      4. bgColor: dominant background hex color (e.g. "#ffffff" or "#000000")
      5. textColor: text hex color (e.g. "#000000" or "#ffffff")

      Respond strictly as a JSON array of objects with keys: "originalText", "translatedText", "box", "bgColor", "textColor". No markdown block.`;

      const result = await model.generateContent([
        { inlineData: { data: base64Data, mimeType } },
        ocrPrompt
      ]);

      const responseText = result.response.text();
      const cleanedJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanedJson);
      
      setOcrResults(parsed);
      renderTranslatedCanvas(selectedImage, parsed);

    } catch (err) {
      console.error(err);
      setErrorMsg('Došlo je do greške prilikom prevođenja: ' + (err.message || 'Nepoznata greška'));
    } finally {
      setIsTranslating(false);
    }
  };

  const downloadImage = () => {
    if (!translatedImageUrl) return;
    const link = document.createElement('a');
    link.download = 'prevedena-slika.png';
    link.href = translatedImageUrl;
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/30">
              <Languages className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                AI Vizuelni Prevodilac Slika
              </h1>
              <p className="text-xs text-slate-400">Prevedi tekst i preuzmi novu sliku</p>
            </div>
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 text-xs font-medium hover:bg-slate-700 transition"
          >
            <Settings className="w-4 h-4 text-slate-400" />
            <span>{apiKey ? 'API Ključ Podešen' : 'Unesi API Ključ'}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Kontrole */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-400" /> Podešavanja
            </h2>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-2">Ciljani jezik:</label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.name}>{l.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-2">Ubaci sliku za prevod:</label>
              <label className="border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition bg-slate-950/50 hover:bg-slate-950">
                <Upload className="w-8 h-8 text-indigo-400" />
                <span className="text-xs font-medium text-slate-300">Klikni ili prevuci sliku ovde</span>
                <span className="text-[10px] text-slate-500">PNG, JPG do 10MB</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Primeri:</label>
              <div className="grid grid-cols-3 gap-2">
                {SAMPLES.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => selectSample(s.url)}
                    className="group relative rounded-lg overflow-hidden border border-slate-800 aspect-video hover:border-indigo-500 transition"
                  >
                    <img src={s.url} alt={s.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                  </button>
                ))}
              </div>
            </div>

            <button
              disabled={!selectedImage || isTranslating}
              onClick={processTranslation}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition duration-200"
            >
              {isTranslating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Generisanje Prevedene Slike...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Prevedi Sliku</span>
                </>
              )}
            </button>

            {errorMsg && (
              <div className="p-3 bg-red-950/50 border border-red-800 rounded-xl text-xs text-red-300 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
        </div>

        {/* Prikaz i Preuzimanje */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-indigo-400" /> Rezultat Prevođenja
            </h3>

            {translatedImageUrl && (
              <button
                onClick={downloadImage}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs shadow-lg shadow-emerald-600/30 transition"
              >
                <Download className="w-4 h-4" />
                <span>Preuzmi Prevedenu Sliku</span>
              </button>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 min-h-[450px] flex items-center justify-center relative overflow-hidden">
            {!selectedImage ? (
              <div className="text-center text-slate-500 flex flex-col items-center gap-3">
                <ImageIcon className="w-12 h-12 opacity-30" />
                <p className="text-sm">Učitaj sliku sa leve strane da počneš</p>
              </div>
            ) : (
              <div className="relative max-w-full max-h-[600px] rounded-lg overflow-hidden shadow-2xl">
                <img
                  src={translatedImageUrl || selectedImage}
                  alt="Result"
                  className="max-h-[600px] w-auto object-contain rounded-lg"
                />
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>
      </main>

      {showSettings && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-400" /> Google Gemini API Ključ
            </h3>
            <input
              type="password"
              placeholder="AIzaSy..."
              defaultValue={apiKey}
              id="api-key-input"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm font-mono text-slate-200"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-xs text-slate-400">Otkaži</button>
              <button
                onClick={() => handleSaveApiKey(document.getElementById('api-key-input').value)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold"
              >
                Sačuvaj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
