import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, Pause, Play, Trash2, FolderOpen, File, Settings, Calendar, 
  Video, Music, FileText, Cpu, Archive, Plus, Search, Shield, Globe, 
  Activity, X, ExternalLink, AlertCircle, RefreshCw, Layers
} from 'lucide-react';
import { DownloadItem, AppSettings, MediaStreamInfo } from '../shared/types';

// Declare global API exposed by preload
declare global {
  interface Window {
    api: {
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<void>;
      getDownloads: () => Promise<DownloadItem[]>;
      addDownload: (url: string, path?: string, headers?: Record<string, string>, title?: string, exactFilePath?: string) => Promise<DownloadItem>;
      startDownload: (id: string) => Promise<void>;
      pauseDownload: (id: string) => Promise<void>;
      deleteDownload: (id: string) => Promise<void>;
      deleteAllDownloads: () => Promise<void>;
      getDetectedMedia: () => Promise<MediaStreamInfo[]>;
      clearDetectedMedia: () => Promise<void>;
      onDownloadProgress: (callback: (item: DownloadItem) => void) => void;
      onMediaDetected: (callback: (media: MediaStreamInfo) => void) => void;
      openFile: (filePath: string) => Promise<boolean>;
      openFolder: (filePath: string) => Promise<boolean>;
      selectDirectory: () => Promise<string | null>;
      selectSavePath: (defaultPath: string) => Promise<string | null>;
      dragStart: (id: string) => void;
    };
  }
}

export default function App() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [detectedMedia, setDetectedMedia] = useState<MediaStreamInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  
  // Navigation & Filtering
  const [selectedNav, setSelectedNav] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal States
  const [isAddUrlOpen, setIsAddUrlOpen] = useState(false);
  const [newDownloadUrl, setNewDownloadUrl] = useState('');
  const [customSaveDir, setCustomSaveDir] = useState<string | null>(null);

  // Speed History for Graph
  const [speedHistory, setSpeedHistory] = useState<number[]>(new Array(30).fill(0));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load Initial Data
  useEffect(() => {
    async function loadData() {
      try {
        const initialSettings = await window.api.getSettings();
        setSettings(initialSettings);

        const initialDownloads = await window.api.getDownloads();
        setDownloads(initialDownloads);

        const initialMedia = await window.api.getDetectedMedia();
        setDetectedMedia(initialMedia);
      } catch (e) {
        console.error('Failed to load initial desktop data:', e);
      }
    }
    loadData();

    // Setup Progress IPC Listener
    window.api.onDownloadProgress((updatedItem) => {
      setDownloads(prev => {
        const idx = prev.findIndex(item => item.id === updatedItem.id);
        if (idx !== -1) {
          const newArray = [...prev];
          newArray[idx] = { ...newArray[idx], ...updatedItem };
          return newArray;
        } else {
          return [updatedItem, ...prev];
        }
      });
    });

    // Setup Media Stream Interception IPC Listener
    window.api.onMediaDetected((media) => {
      setDetectedMedia(prev => {
        const exists = prev.some(m => m.url === media.url);
        if (exists) return prev;
        return [media, ...prev];
      });
    });
  }, []);

  // Update Speed Graph every second
  useEffect(() => {
    const interval = setInterval(() => {
      // Calculate current cumulative speed
      const totalSpeed = downloads
        .filter(d => d.status === 'downloading')
        .reduce((sum, d) => sum + (d.speed || 0), 0);

      setSpeedHistory(prev => {
        const next = [...prev.slice(1), totalSpeed];
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [downloads]);

  // Draw Speed Graph Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.clearRect(0, 0, width, height);

    // Max value for scaling
    const maxVal = Math.max(...speedHistory, 1024 * 1024); // scale at least to 1MB/s

    // Set line path
    ctx.beginPath();
    ctx.lineWidth = 3;
    
    // Gradient Stroke
    const strokeGrad = ctx.createLinearGradient(0, 0, width, 0);
    strokeGrad.addColorStop(0, '#6366f1'); // Indigo
    strokeGrad.addColorStop(0.5, '#a855f7'); // Violet
    strokeGrad.addColorStop(1, '#ec4899'); // Pink
    ctx.strokeStyle = strokeGrad;

    const points = speedHistory.map((val, idx) => {
      const x = (idx / (speedHistory.length - 1)) * width;
      const y = height - (val / maxVal) * (height - 10) - 5;
      return { x, y };
    });

    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();

    // Fill Gradient below curve
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    
    const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
    fillGrad.addColorStop(0, 'rgba(99, 102, 241, 0.2)');
    fillGrad.addColorStop(1, 'rgba(99, 102, 241, 0)');
    ctx.fillStyle = fillGrad;
    ctx.fill();

  }, [speedHistory]);

  // Operations
  const handleStart = async (id: string) => {
    await window.api.startDownload(id);
  };

  const handlePause = async (id: string) => {
    await window.api.pauseDownload(id);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to remove this download log?')) {
      await window.api.deleteDownload(id);
      setDownloads(prev => prev.filter(d => d.id !== id));
    }
  };

  const handleDeleteAll = async () => {
    if (downloads.length === 0) return;
    if (confirm('Are you sure you want to remove ALL downloads? This will cancel any active downloads and delete their temporary files.')) {
      await window.api.deleteAllDownloads();
      setDownloads([]);
    }
  };

  const handlePauseAll = () => {
    downloads.forEach(d => {
      if (d.status === 'downloading') {
        handlePause(d.id);
      }
    });
  };

  const handleResumeAll = () => {
    downloads.forEach(d => {
      if (d.status === 'paused' || d.status === 'queued') {
        handleStart(d.id);
      }
    });
  };

  const handleAddDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDownloadUrl) return;

    try {
      let exactFilePath: string | undefined = undefined;

      if (settings?.general.askSaveLocation) {
        let suggestedFileName = 'download';
        try {
          const urlObj = new URL(newDownloadUrl);
          suggestedFileName = urlObj.pathname.split('/').pop() || 'download';
          if (!suggestedFileName || suggestedFileName.includes('?')) {
            suggestedFileName = 'download';
          }
        } catch (err) {}

        const defaultDir = customSaveDir || settings?.general.defaultSaveDirectory || '';
        const defaultFilePath = `${defaultDir}/${suggestedFileName}`;
        const selected = await window.api.selectSavePath(defaultFilePath);
        if (!selected) return; // User cancelled
        exactFilePath = selected;
      }

      const item = await window.api.addDownload(
        newDownloadUrl,
        exactFilePath ? undefined : (customSaveDir || undefined),
        undefined,
        undefined,
        exactFilePath
      );
      
      setIsAddUrlOpen(false);
      setNewDownloadUrl('');
      setCustomSaveDir(null);
      
      // Start download immediately
      await window.api.startDownload(item.id);
      
      // Refresh downloads list
      const list = await window.api.getDownloads();
      setDownloads(list);
    } catch (e: any) {
      alert('Failed to add download URL: ' + e.message);
    }
  };

  const selectCustomSaveDirectory = async () => {
    const dir = await window.api.selectDirectory();
    if (dir) {
      setCustomSaveDir(dir);
    }
  };

  const handleOpenFile = async (path: string) => {
    const opened = await window.api.openFile(path);
    if (!opened) {
      alert('File could not be opened or is missing.');
    }
  };

  const handleOpenFolder = async (path: string) => {
    await window.api.openFolder(path);
  };

  const handleSaveSettings = async (updatedSettings: AppSettings) => {
    setSettings(updatedSettings);
    await window.api.saveSettings(updatedSettings);
    alert('Settings saved successfully.');
  };

  // Filter Logic
  const filteredDownloads = downloads.filter(item => {
    const matchesSearch = item.fileName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.url.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (!matchesSearch) return false;
    
    if (selectedNav === 'all') return true;
    if (selectedNav === 'videos') return item.category === 'videos';
    if (selectedNav === 'music') return item.category === 'music';
    if (selectedNav === 'documents') return item.category === 'documents';
    if (selectedNav === 'programs') return item.category === 'programs';
    if (selectedNav === 'archives') return item.category === 'archives';
    
    return true;
  });

  const getCategoryCount = (cat: string) => {
    if (cat === 'all') return downloads.length;
    return downloads.filter(d => d.category === cat).length;
  };

  // Helper formatting values
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === -1) return 'Unknown size';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSec?: number) => {
    if (!bytesPerSec) return '0 B/s';
    return formatBytes(bytesPerSec, 1) + '/s';
  };

  const formatETA = (sec?: number) => {
    if (sec === undefined) return '--';
    if (sec === 999999) return 'Paused';
    if (sec === 0) return 'Done';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    
    let str = '';
    if (hrs > 0) str += `${hrs}h `;
    if (mins > 0 || hrs > 0) str += `${mins}m `;
    str += `${secs}s`;
    return str;
  };

  const getStatusColor = (status: DownloadItem['status']) => {
    switch (status) {
      case 'downloading': return 'text-sky-400';
      case 'completed': return 'text-emerald-400';
      case 'paused': return 'text-yellow-400';
      case 'failed': return 'text-red-400';
      default: return 'text-indigo-400';
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      
      {/* Sidebar Navigation */}
      <aside style={{
        width: '260px',
        backgroundColor: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-color)',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <div>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px', paddingLeft: '8px' }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
              borderRadius: '8px',
              padding: '6px',
              color: 'white'
            }}>
              <Layers size={22} />
            </div>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: '800', tracking: '-0.02em', background: 'linear-gradient(to right, #f8fafc, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                AetherDownload
              </h1>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>IDM Evolution</p>
            </div>
          </div>

          {/* Navigation Items */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <p style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', paddingLeft: '12px', marginBottom: '8px', textTransform: 'uppercase' }}>
              Categories
            </p>
            {[
              { id: 'all', label: 'All Downloads', icon: Download },
              { id: 'videos', label: 'Videos', icon: Video },
              { id: 'music', label: 'Music', icon: Music },
              { id: 'documents', label: 'Documents', icon: FileText },
              { id: 'programs', label: 'Programs', icon: Cpu },
              { id: 'archives', label: 'Archives', icon: Archive },
            ].map(item => {
              const Icon = item.icon;
              const isActive = selectedNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedNav(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: isActive ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                    border: isActive ? '1px solid rgba(99, 102, 241, 0.2)' : '1px solid transparent',
                    color: isActive ? '#f8fafc' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-family)',
                    fontSize: '13.5px',
                    fontWeight: isActive ? '600' : '400',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  className={!isActive ? 'sidebar-btn-hover' : ''}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Icon size={16} color={isActive ? '#818cf8' : 'var(--text-muted)'} />
                    {item.label}
                  </div>
                  <span style={{
                    fontSize: '11px',
                    backgroundColor: isActive ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    color: isActive ? '#f8fafc' : 'var(--text-muted)'
                  }}>
                    {getCategoryCount(item.id)}
                  </span>
                </button>
              );
            })}

            <p style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', paddingLeft: '12px', marginTop: '24px', marginBottom: '8px', textTransform: 'uppercase' }}>
              Advanced Tools
            </p>
            {[
              { id: 'media-grabber', label: 'Media Grabber', icon: Globe, count: detectedMedia.length },
              { id: 'scheduler', label: 'Scheduler', icon: Calendar },
              { id: 'settings', label: 'Configuration', icon: Settings },
            ].map(item => {
              const Icon = item.icon;
              const isActive = selectedNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedNav(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: isActive ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                    border: isActive ? '1px solid rgba(99, 102, 241, 0.2)' : '1px solid transparent',
                    color: isActive ? '#f8fafc' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-family)',
                    fontSize: '13.5px',
                    fontWeight: isActive ? '600' : '400',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  className={!isActive ? 'sidebar-btn-hover' : ''}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Icon size={16} color={isActive ? '#818cf8' : 'var(--text-muted)'} />
                    {item.label}
                  </div>
                  {item.count !== undefined && (
                    <span style={{
                      fontSize: '11px',
                      backgroundColor: 'rgba(56, 189, 248, 0.2)',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      color: '#38bdf8'
                    }}>
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Integration Status footer */}
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          padding: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#10b981',
            boxShadow: '0 0 8px #10b981'
          }} />
          <div>
            <p style={{ fontSize: '11.5px', fontWeight: '600', color: 'var(--text-primary)' }}>Integration Engine</p>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Port 9654 listening</p>
          </div>
        </div>
      </aside>

      {/* Main Dashboard Area */}
      <main style={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '24px 32px'
      }}>
        
        {/* Top Header Row with speed graphs */}
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          gap: '24px'
        }}>
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: '700' }}>Dashboard</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Manage and accelerate your internet files
            </p>
          </div>

          {/* Speed Graph widget */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            padding: '10px 16px',
            borderRadius: '12px',
            width: '320px',
            height: '64px'
          }}>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Total Download Speed
              </p>
              <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--status-downloading)' }}>
                {formatSpeed(downloads.filter(d => d.status === 'downloading').reduce((sum, d) => sum + (d.speed || 0), 0))}
              </h3>
            </div>
            <canvas ref={canvasRef} width="160" height="44" style={{ flexGrow: 1, pointerEvents: 'none' }} />
          </div>
        </header>

        {/* Global Toolbar Control bar */}
        <section style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          gap: '16px'
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setIsAddUrlOpen(true)} className="btn-primary">
              <Plus size={16} />
              Add URL
            </button>
            <button onClick={handleResumeAll} className="btn-secondary">
              <Play size={15} />
              Resume All
            </button>
            <button onClick={handlePauseAll} className="btn-secondary">
              <Pause size={15} />
              Pause All
            </button>
            <button onClick={handleDeleteAll} className="btn-secondary" style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
              <Trash2 size={15} />
              Delete All
            </button>
          </div>

          {/* Search bar */}
          <div style={{
            position: 'relative',
            width: '260px'
          }}>
            <Search size={15} style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)'
            }} />
            <input
              type="text"
              placeholder="Search downloads..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '9px 12px 9px 36px',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-family)',
                fontSize: '13px',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent-primary)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
            />
          </div>
        </section>

        {/* Render View panels dynamically */}
        <section style={{ flexGrow: 1, overflowY: 'auto' }}>
          
          {selectedNav === 'settings' ? (
            <SettingsPanel settings={settings} onSave={handleSaveSettings} />
          ) : selectedNav === 'scheduler' ? (
            <SchedulerPanel settings={settings} onSave={handleSaveSettings} />
          ) : selectedNav === 'media-grabber' ? (
            <MediaGrabberView 
              detected={detectedMedia} 
              setDetected={setDetectedMedia} 
              settings={settings}
              refreshDownloads={async () => {
                const list = await window.api.getDownloads();
                setDownloads(list);
              }}
            />
          ) : (
            // Downloads list panel
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '20px' }}>
              {filteredDownloads.length === 0 ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '80px 20px',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: '12px',
                  border: '1px dashed var(--border-color)',
                  color: 'var(--text-muted)'
                }}>
                  <Download size={40} style={{ marginBottom: '16px', color: 'var(--text-muted)' }} />
                  <p style={{ fontSize: '15px', fontWeight: '500', color: 'var(--text-secondary)' }}>No downloads found</p>
                  <p style={{ fontSize: '12.5px', marginTop: '4px' }}>Click 'Add URL' or download files from your browser.</p>
                </div>
              ) : (
                filteredDownloads.map(item => {
                  const isDownloading = item.status === 'downloading';
                  const isCompleted = item.status === 'completed';
                  const isPaused = item.status === 'paused';
                  const isFailed = item.status === 'failed';
                  
                  return (
                    <div
                      key={item.id}
                      draggable={isCompleted}
                      onDragStart={(e) => {
                        e.preventDefault();
                        window.api.dragStart(item.id);
                      }}
                      className="glass-panel"
                      style={{
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        cursor: isCompleted ? 'grab' : 'default'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
                        
                        {/* Title and Icon */}
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <div style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            padding: '8px',
                            color: 'var(--text-secondary)'
                          }}>
                            {item.category === 'videos' ? <Video size={20} /> :
                             item.category === 'music' ? <Music size={20} /> :
                             item.category === 'documents' ? <FileText size={20} /> :
                             item.category === 'programs' ? <Cpu size={20} /> :
                             item.category === 'archives' ? <Archive size={20} /> :
                             <File size={20} />}
                          </div>
                          <div>
                            <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#f8fafc', wordBreak: 'break-all' }}>
                              {item.fileName}
                            </h4>
                            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', wordBreak: 'break-all' }}>
                              {item.url}
                            </p>
                          </div>
                        </div>

                        {/* Control buttons */}
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                          {isDownloading && (
                            <button onClick={() => handlePause(item.id)} style={{ padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>
                              <Pause size={14} />
                            </button>
                          )}
                          {(isPaused || isFailed || item.status === 'queued') && (
                            <button onClick={() => handleStart(item.id)} style={{ padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>
                              <Play size={14} />
                            </button>
                          )}
                          {isCompleted && (
                            <>
                              <button onClick={() => handleOpenFile(item.savePath)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: '#f8fafc', fontSize: '12px', cursor: 'pointer' }}>
                                <File size={13} /> Open
                              </button>
                              <button onClick={() => handleOpenFolder(item.savePath)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}>
                                <FolderOpen size={13} /> Show
                              </button>
                            </>
                          )}
                          <button onClick={() => handleDelete(item.id)} style={{ padding: '6px', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.2)', backgroundColor: 'transparent', color: '#f87171', cursor: 'pointer' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Progress Bar Row */}
                      {!isCompleted && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{
                            width: '100%',
                            height: '6px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '3px',
                            overflow: 'hidden',
                            position: 'relative'
                          }}>
                            <div style={{
                              width: `${item.totalBytes > 0 ? (item.downloadedBytes / item.totalBytes) * 100 : 0}%`,
                              height: '100%',
                              background: 'linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
                              borderRadius: '3px',
                              transition: 'width 0.2s ease',
                              position: 'relative'
                            }}>
                              {isDownloading && <div className="progress-bar-shimmer" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />}
                            </div>
                          </div>
                          
                          {/* Segment progress indicators (dynamic parallel streams bar) */}
                          {isDownloading && item.segments.length > 0 && (
                            <div style={{ display: 'flex', gap: '2px', height: '3px', width: '100%' }}>
                              {item.segments.map((seg, idx) => {
                                const segRatio = seg.end > 0 ? (seg.downloaded / (seg.end - seg.start)) : 0;
                                return (
                                  <div
                                    key={idx}
                                    style={{
                                      flexGrow: 1,
                                      height: '100%',
                                      backgroundColor: seg.status === 'completed' ? '#10b981' : 
                                                       seg.status === 'downloading' ? 'rgba(56, 189, 248, 0.5)' : 
                                                       'rgba(255, 255, 255, 0.03)',
                                      borderRadius: '1px'
                                    }}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Item Info Footer */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '12px',
                        color: 'var(--text-secondary)'
                      }}>
                        <div style={{ display: 'flex', gap: '16px' }}>
                          <span>Size: <b>{formatBytes(item.totalBytes)}</b></span>
                          <span>Progress: <b>{item.totalBytes > 0 ? `${Math.round((item.downloadedBytes / item.totalBytes) * 100)}%` : '0%'}</b></span>
                          {isDownloading && <span>Speed: <b className="text-sky-400">{formatSpeed(item.speed)}</b></span>}
                          {isDownloading && <span>ETA: <b>{formatETA(item.eta)}</b></span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '10.5px' }} className={getStatusColor(item.status)}>
                            ● {item.status.toUpperCase()}
                          </span>
                        </div>
                      </div>

                      {/* Error Banner */}
                      {item.errorMessage && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          color: '#f87171',
                          fontSize: '12px'
                        }}>
                          <AlertCircle size={14} />
                          {item.errorMessage}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      </main>

      {/* Add URL Overlay Modal */}
      {isAddUrlOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="glass-panel" style={{
            width: '540px',
            padding: '24px',
            backgroundColor: '#0f1524'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Add New Download</h3>
              <button onClick={() => setIsAddUrlOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleAddDownload} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Paste Address (URL)
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://example.com/file.zip"
                  value={newDownloadUrl}
                  onChange={e => setNewDownloadUrl(e.target.value)}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: '#f8fafc',
                    fontFamily: 'var(--font-family)',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Save Location
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    readOnly
                    placeholder={customSaveDir || settings?.general.defaultSaveDirectory || 'Default directory'}
                    style={{
                      flexGrow: 1,
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontSize: '12.5px',
                      outline: 'none'
                    }}
                  />
                  <button type="button" onClick={selectCustomSaveDirectory} className="btn-secondary">
                    Browse
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button type="button" onClick={() => setIsAddUrlOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Download
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Media Grabber tab view
function MediaGrabberView({ 
  detected, 
  setDetected, 
  settings, 
  refreshDownloads 
}: { 
  detected: MediaStreamInfo[], 
  setDetected: React.Dispatch<React.SetStateAction<MediaStreamInfo[]>>,
  settings: AppSettings | null,
  refreshDownloads: () => Promise<void>
}) {
  const handleDownload = async (stream: MediaStreamInfo) => {
    try {
      let exactFilePath: string | undefined = undefined;

      if (settings?.general.askSaveLocation) {
        const defaultDir = settings.general.defaultSaveDirectory || '';
        let cleanTitle = stream.title.replace(/[\\/:*?"<>|]/g, '_').trim();
        if (!cleanTitle.toLowerCase().endsWith(`.${stream.format}`)) {
          cleanTitle += `.${stream.format}`;
        }
        const defaultFilePath = `${defaultDir}/${cleanTitle}`;
        const selected = await window.api.selectSavePath(defaultFilePath);
        if (!selected) return; // Cancelled
        exactFilePath = selected;
      }

      const item = await window.api.addDownload(stream.url, undefined, stream.headers, stream.title, exactFilePath);
      await window.api.startDownload(item.id);
      alert(`Download started for intercepted stream: ${stream.title}`);
      await refreshDownloads();
    } catch (e: any) {
      alert('Could not start download: ' + e.message);
    }
  };

  const handleClear = async () => {
    await window.api.clearDetectedMedia();
    setDetected([]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Media Stream Grabber</h3>
          <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Detected streaming media from floating browser panels.</p>
        </div>
        <button onClick={handleClear} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
          Clear list
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {detected.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            backgroundColor: 'var(--bg-card)',
            borderRadius: '12px',
            border: '1px dashed var(--border-color)',
            color: 'var(--text-muted)'
          }}>
            <Globe size={32} style={{ marginBottom: '12px' }} />
            <p style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-secondary)' }}>No streams grabbed yet</p>
            <p style={{ fontSize: '12px', marginTop: '4px', textAlign: 'center', maxWidth: '320px' }}>
              Open a video player in Google Chrome or Microsoft Edge with our extension to intercept streams.
            </p>
          </div>
        ) : (
          detected.map((stream, idx) => (
            <div key={idx} className="glass-panel" style={{
              padding: '14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h4 style={{ fontSize: '13.5px', fontWeight: '600' }}>{stream.title}</h4>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', wordBreak: 'break-all' }}>
                  {stream.url.substring(0, 100)}...
                </p>
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <span style={{ fontSize: '10px', backgroundColor: 'rgba(99, 102, 241, 0.15)', padding: '2px 6px', borderRadius: '4px', color: '#818cf8', fontWeight: '700' }}>
                    {stream.format.toUpperCase()}
                  </span>
                </div>
              </div>
              <button onClick={() => handleDownload(stream)} className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }}>
                Download Stream
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Settings Panel Component
function SettingsPanel({ settings, onSave }: { settings: AppSettings | null, onSave: (s: AppSettings) => void }) {
  const [connections, setConnections] = useState(8);
  const [speedLimit, setSpeedLimit] = useState(0);
  const [launchOnStart, setLaunchOnStart] = useState(true);
  const [askSaveLocation, setAskSaveLocation] = useState(false);
  const [defaultSave, setDefaultSave] = useState('');
  const [tempDir, setTempDir] = useState('');

  useEffect(() => {
    if (settings) {
      setConnections(settings.network.maxConnections);
      setSpeedLimit(settings.network.speedLimit / 1024); // to KB/s
      setLaunchOnStart(settings.general.launchOnStart);
      setAskSaveLocation(settings.general.askSaveLocation);
      setDefaultSave(settings.general.defaultSaveDirectory);
      setTempDir(settings.general.tempDirectory);
    }
  }, [settings]);

  const selectSaveDir = async () => {
    const dir = await window.api.selectDirectory();
    if (dir) setDefaultSave(dir);
  };

  const selectTempDir = async () => {
    const dir = await window.api.selectDirectory();
    if (dir) setTempDir(dir);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    const newSettings: AppSettings = {
      ...settings,
      general: {
        ...settings.general,
        launchOnStart,
        askSaveLocation,
        defaultSaveDirectory: defaultSave,
        tempDirectory: tempDir
      },
      network: {
        ...settings.network,
        maxConnections: connections,
        speedLimit: speedLimit * 1024 // back to bytes
      }
    };
    onSave(newSettings);
  };

  if (!settings) return <div style={{ color: 'var(--text-muted)' }}>Loading configurations...</div>;

  return (
    <div className="glass-panel" style={{ padding: '24px', backgroundColor: '#0f1524' }}>
      <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>Application Configuration</h3>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Speed acceleration counts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Max Connections (Parallel Streams)
            </label>
            <select
              value={connections}
              onChange={e => setConnections(Number(e.target.value))}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '10px',
                color: '#f8fafc',
                outline: 'none'
              }}
            >
              {[1, 2, 4, 8, 16, 24, 32].map(n => (
                <option key={n} value={n}>{n} connections</option>
              ))}
            </select>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
              Splits downloads dynamically for up to 5x acceleration.
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Bandwidth Speed Limiter (KB/s)
            </label>
            <input
              type="number"
              min="0"
              placeholder="0 (Unlimited)"
              value={speedLimit}
              onChange={e => setSpeedLimit(Number(e.target.value))}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '9px 12px',
                color: '#f8fafc',
                outline: 'none'
              }}
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
              Enter 0 to disable speed throttling.
            </span>
          </div>
        </div>

        {/* Directory settings */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Default Save Folder
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              readOnly
              value={defaultSave}
              style={{
                flexGrow: 1,
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '10px 12px',
                color: 'var(--text-secondary)',
                fontSize: '12.5px'
              }}
            />
            <button type="button" onClick={selectSaveDir} className="btn-secondary">
              Browse
            </button>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Temporary Assembly Folder
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              readOnly
              value={tempDir}
              style={{
                flexGrow: 1,
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '10px 12px',
                color: 'var(--text-secondary)',
                fontSize: '12.5px'
              }}
            />
            <button type="button" onClick={selectTempDir} className="btn-secondary">
              Browse
            </button>
          </div>
        </div>

        {/* Startup switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
          <input
            type="checkbox"
            id="launchOnStart"
            checked={launchOnStart}
            onChange={e => setLaunchOnStart(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)' }}
          />
          <label htmlFor="launchOnStart" style={{ fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
            Launch AetherDownload on Windows startup (minimize to system tray)
          </label>
        </div>

        {/* Ask download location switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
          <input
            type="checkbox"
            id="askSaveLocation"
            checked={askSaveLocation}
            onChange={e => setAskSaveLocation(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)' }}
          />
          <label htmlFor="askSaveLocation" style={{ fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
            Show save dialog to ask for download location and filename for each download
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button type="submit" className="btn-primary">
            Save Configuration
          </button>
        </div>
      </form>
    </div>
  );
}

// Scheduler Panel Component
function SchedulerPanel({ settings, onSave }: { settings: AppSettings | null, onSave: (s: AppSettings) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [startTime, setStartTime] = useState('02:00:00');
  const [stopTime, setStopTime] = useState('05:00:00');
  const [shutdown, setShutdown] = useState(false);

  useEffect(() => {
    if (settings) {
      setEnabled(settings.scheduler.enabled);
      setStartTime(settings.scheduler.startTime || '02:00:00');
      setStopTime(settings.scheduler.stopTime || '05:00:00');
      setShutdown(settings.scheduler.shutdownOnComplete);
    }
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    const newSettings: AppSettings = {
      ...settings,
      scheduler: {
        enabled,
        startTime,
        stopTime,
        shutdownOnComplete: shutdown,
        disconnectOnComplete: false
      }
    };
    onSave(newSettings);
  };

  if (!settings) return <div style={{ color: 'var(--text-muted)' }}>Loading scheduler...</div>;

  return (
    <div className="glass-panel" style={{ padding: '24px', backgroundColor: '#0f1524' }}>
      <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>Scheduler / Queue Automation</h3>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Enable scheduling */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="checkbox"
            id="schedulerActive"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)' }}
          />
          <label htmlFor="schedulerActive" style={{ fontSize: '13.5px', fontWeight: '600', color: 'var(--text-primary)', cursor: 'pointer' }}>
            Enable automated timed download sessions
          </label>
        </div>

        {/* Timers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Daily Queue Start Time
            </label>
            <input
              type="text"
              placeholder="HH:MM:SS"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '9px 12px',
                color: '#f8fafc',
                outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Daily Queue Pause/Stop Time
            </label>
            <input
              type="text"
              placeholder="HH:MM:SS"
              value={stopTime}
              onChange={e => setStopTime(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '9px 12px',
                color: '#f8fafc',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* Actions after download complete */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              id="shutdownOnComplete"
              checked={shutdown}
              onChange={e => setShutdown(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)' }}
            />
            <label htmlFor="shutdownOnComplete" style={{ fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
              Shut down computer automatically after completing active queues
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button type="submit" className="btn-primary">
            Apply Scheduler Settings
          </button>
        </div>
      </form>
    </div>
  );
}
