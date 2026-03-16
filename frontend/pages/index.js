import { useState, useEffect } from 'react';
import Head from 'next/head';
import { Video, Play, Download, Loader2, Send } from 'lucide-react';

export default function Home() {
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const [text, setText] = useState('');
  const [voice, setVoice] = useState('es');
  const [taskId, setTaskId] = useState(null);
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState(null);
  const [manualApiUrl, setManualApiUrl] = useState('');
  const [showManualUrl, setShowManualUrl] = useState(false);

  // Determine final API URL
  const EFFECTIVE_API_URL = manualApiUrl || API_BASE_URL;

  useEffect(() => {
    let interval;
    if (taskId && !videoUrl && !error) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${EFFECTIVE_API_URL}/api/status/${taskId}`);
          const data = await res.json();
          setStatus(data.status);
          setProgress(data.progress);
          if (data.status === 'completed') {
            setVideoUrl(`${EFFECTIVE_API_URL}${data.videoUrl}`);
            setLoading(false);
            clearInterval(interval);
          } else if (data.status === 'failed') {
            setError(data.error);
            setLoading(false);
            clearInterval(interval);
          }
        } catch (err) {
          console.error('Error fetching status:', err);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [taskId, videoUrl, error, EFFECTIVE_API_URL]);

  const handleGenerate = async () => {
    setLoading(true);
    setVideoUrl(null);
    setError(null);
    setTaskId(null);
    setProgress(0);
    setStatus('Iniciando...');

    try {
      const res = await fetch(`${EFFECTIVE_API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTaskId(data.taskId);
    } catch (err) {
      setError(`Error de conexión: ${err.message}. (URL intentada: ${EFFECTIVE_API_URL})`);
      setShowManualUrl(true);
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <Head>
        <title>AI Video Narrator</title>
        <meta name="description" content="Transform text to narrated video with AI" />
      </Head>

      <main className="main">
        <header className="header">
          <div className="logo">
            <Video size={32} color="#6366f1" />
            <h1>AI Video Generator</h1>
          </div>
          <p className="subtitle">Convierte tus historias en videos verticales impactantes</p>
        </header>

        {showManualUrl && (
          <div className="card manual-url-card anim-fade-in">
            <p><strong>🛠️ Reparación de Conexión:</strong></p>
            <p className="small">Vercel no está detectando tu servidor. Pega aquí tu URL de Railway (que empiece con https://):</p>
            <div className="form-row">
              <input 
                type="text" 
                placeholder="https://tu-backend.railway.app" 
                value={manualApiUrl}
                onChange={(e) => setManualApiUrl(e.target.value)}
                className="input-manual"
              />
              <button className="btn btn-secondary btn-sm" onClick={() => setShowManualUrl(false)}>Ocultar</button>
            </div>
          </div>
        )}

        <section className="input-section card">
          <div className="form-group">
            <label>Texto del Video</label>
            <textarea
              placeholder="Escribe el guion de tu video aquí..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Seleccionar Idioma de Narración</label>
              <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                <option value="es">Español (Google TTS)</option>
                <option value="en">Inglés (Google TTS)</option>
                <option value="pt">Portugués (Google TTS)</option>
                <option value="fr">Francés (Google TTS)</option>
                <option value="it">Italiano (Google TTS)</option>
              </select>
            </div>

            <button 
              className="btn btn-primary" 
              onClick={handleGenerate} 
              disabled={loading || !text.trim()}
            >
              {loading ? <Loader2 className="animate-spin" /> : <Send size={18} />}
              {loading ? 'Generando...' : 'Generar Video'}
            </button>
          </div>
        </section>

        {loading && (
          <section className="progress-section card anim-fade-in">
            <div className="progress-header">
              <span className="status">{status}</span>
              <span className="percent">{progress}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </section>
        )}

        {error && (
          <div className="error-message card anim-fade-in">
            <p>Error: {error}</p>
          </div>
        )}

        {videoUrl && (
          <section className="preview-section card anim-fade-in">
            <h2>Vista Previa del Video</h2>
            <div className="preview-container">
              <video src={videoUrl} controls className="video-player" />
            </div>
            <div className="actions-row">
              <a href={videoUrl} download className="btn btn-secondary" target="_blank" rel="noopener noreferrer">
                <Download size={18} />
                Descargar MP4
              </a>
            </div>
          </section>
        )}
      </main>

      <style jsx global>{`
        :root {
          --bg: #0f172a;
          --card: #1e293b;
          --text: #f8fafc;
          --primary: #6366f1;
          --primary-hover: #4f46e5;
          --border: #334155;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          padding: 0;
          font-family: 'Inter', system-ui, sans-serif;
          background-color: var(--bg);
          color: var(--text);
          line-height: 1.5;
        }

        .container {
          max-width: 800px;
          margin: 0 auto;
          padding: 2rem 1rem;
        }

        .header {
          text-align: center;
          margin-bottom: 3rem;
        }

        .logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .logo h1 {
          margin: 0;
          font-size: 2.5rem;
          font-weight: 800;
          background: linear-gradient(to right, #818cf8, #6366f1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .subtitle {
          color: #94a3b8;
          font-size: 1.125rem;
        }

        .card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 1rem;
          padding: 2rem;
          margin-bottom: 2rem;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
          backdrop-filter: blur(10px);
        }

        .form-group {
          margin-bottom: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        label {
          font-weight: 600;
          color: #cbd5e1;
          font-size: 0.875rem;
        }

        textarea, select {
          background: #0f172a;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          color: white;
          padding: 1rem;
          font-size: 1rem;
          outline: none;
          transition: border-color 0.2s;
        }

        textarea:focus, select:focus {
          border-color: var(--primary);
        }

        .form-row {
          display: flex;
          gap: 1.5rem;
          align-items: flex-end;
          flex-wrap: wrap;
        }

        .form-row .form-group {
          flex: 1;
          min-width: 250px;
          margin-bottom: 0;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          border-radius: 0.5rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
          text-decoration: none;
          font-size: 1rem;
        }

        .btn-primary {
          background: var(--primary);
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: var(--primary-hover);
          transform: translateY(-1px);
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-secondary {
          background: #334155;
          color: white;
        }

        .btn-secondary:hover {
          background: #475569;
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.75rem;
        }

        .status { color: #94a3b8; }
        .percent { font-weight: bold; color: var(--primary); }

        .progress-bar {
          height: 0.5rem;
          background: #0f172a;
          border-radius: 1rem;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: var(--primary);
          transition: width 0.3s ease;
        }

        .preview-container {
          display: flex;
          justify-content: center;
          margin: 2rem 0;
          background: #000;
          border-radius: 0.5rem;
          overflow: hidden;
          aspect-ratio: 9/16;
          max-height: 600px;
        }

        .video-player {
          width: 100%;
          height: 100%;
        }

        .actions-row {
          display: flex;
          justify-content: center;
        }

        .manual-url-card {
          background: #1e1b4b;
          border: 1px dashed #6366f1;
          margin-bottom: 2rem;
          padding: 1.5rem;
        }

        .input-manual {
          flex: 1;
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 0.5rem;
          color: white;
          padding: 0.75rem;
          font-size: 0.875rem;
        }

        .small {
          font-size: 0.825rem;
          color: #94a3b8;
          margin-bottom: 1rem;
          display: block;
        }

        .btn-sm {
          padding: 0.5rem 1rem;
          font-size: 0.875rem;
        }

        .anim-fade-in {
          animation: fadeIn 0.5s ease-out;
        }

        .animate-spin {
          animation: spin 1s linear infinite;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
