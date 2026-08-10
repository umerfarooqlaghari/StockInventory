import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';

export default function BarcodeScannerModal({ onClose, onScanSuccess }) {
  const videoRef = useRef(null);
  const [manualCode, setManualCode] = useState('');
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' (back) or 'user' (front)
  const [cameraError, setCameraError] = useState('');
  const [activeStream, setActiveStream] = useState(null);
  const [scanning, setScanning] = useState(true);
  const bufferRef = useRef('');

  // Play a brief 800Hz beep for scan feedback
  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // AudioContext disabled or unsupported
    }
  }

  // 1. Setup Camera Media Stream
  useEffect(() => {
    let stream = null;
    let animId = null;

    async function startCamera() {
      try {
        setCameraError('');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        setActiveStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Setup Barcode Detector loop if available natively
        if ('BarcodeDetector' in window) {
          const barcodeDetector = new window.BarcodeDetector({
            formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e']
          });

          const detectFrame = async () => {
            if (videoRef.current && videoRef.current.readyState === 4) {
              try {
                const barcodes = await barcodeDetector.detect(videoRef.current);
                if (barcodes && barcodes.length > 0) {
                  const code = barcodes[0].rawValue;
                  if (code) {
                    playBeep();
                    onScanSuccess(code);
                    return;
                  }
                }
              } catch {
                // Ignore detection frame error
              }
            }
            animId = requestAnimationFrame(detectFrame);
          };
          detectFrame();
        }
      } catch (err) {
        setCameraError('Camera access unavailable or denied. You can still type or use a USB scanner.');
      }
    }

    startCamera();

    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [facingMode, onScanSuccess]);

  // 2. Hardware / USB Barcode Gun Listener
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Enter') {
        if (bufferRef.current.trim()) {
          const code = bufferRef.current.trim();
          bufferRef.current = '';
          playBeep();
          onScanSuccess(code);
        }
      } else if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onScanSuccess]);

  function handleManualSubmit(e) {
    e.preventDefault();
    if (!manualCode.trim()) return;
    playBeep();
    onScanSuccess(manualCode.trim());
  }

  function toggleCamera() {
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
  }

  return (
    <Modal title="📷 Scan Barcode / QR Code" onClose={onClose}>
      <div style={{ textAlign: 'center' }}>
        {/* Camera Viewfinder */}
        <div style={{
          position: 'relative',
          width: '100%',
          maxWidth: '480px',
          height: '260px',
          margin: '0 auto 16px',
          background: '#0f172a',
          borderRadius: '12px',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid var(--blue)',
        }}>
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />

          {/* Scanner Overlay Box */}
          <div style={{
            position: 'absolute',
            width: '75%',
            height: '55%',
            border: '2px dashed #60a5fa',
            borderRadius: '8px',
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{
              width: '100%',
              height: '2px',
              background: '#ef4444',
              boxShadow: '0 0 8px #ef4444',
              animation: 'scanLine 2s infinite ease-in-out',
            }} />
          </div>

          {/* Camera Switcher Button */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={toggleCamera}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: 'rgba(15, 23, 42, 0.75)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              backdropFilter: 'blur(4px)',
            }}
          >
            🔄 Switch Camera ({facingMode === 'environment' ? 'Rear' : 'Front'})
          </button>
        </div>

        {cameraError && (
          <p style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 12, background: 'var(--yellow-bg)', padding: '8px 12px', borderRadius: 6 }}>
            ⚠️ {cameraError}
          </p>
        )}

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Point camera at barcode, scan with USB reader, or enter code manually below.
        </p>

        {/* Manual Barcode Entry Form */}
        <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Type Barcode or Item Code…"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            style={{ flex: 1, fontSize: 14 }}
            autoFocus
          />
          <button type="submit" className="btn btn-primary">
            🔍 Lookup Code
          </button>
        </form>
      </div>

      <style>{`
        @keyframes scanLine {
          0% { transform: translateY(-40px); }
          50% { transform: translateY(40px); }
          100% { transform: translateY(-40px); }
        }
      `}</style>
    </Modal>
  );
}
