'use client';

import { useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { decryptPayload } from '../../lib/cryptos';

export default function VerifyPage() {
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [decryptedData, setDecryptedData] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = (data: string | null) => {
    if (data && !scanResult) {
      setScanResult(data);
      if (!data.startsWith('http') && !data.startsWith('/')) {
        setIsEncrypted(true);
      } else {
        console.log('Deep link scanned:', data);
      }
    }
  };

  const handleDecrypt = async () => {
    setError(null);
    try {
      if (!scanResult) throw new Error('No data scanned.');
      const payload = await decryptPayload(scanResult, passphrase);
      setDecryptedData(JSON.stringify(payload, null, 2));
    } catch (e) {
      setError('Decryption failed. Invalid passphrase or tampered data.');
    }
  };

  const handleSaveCredential = () => {
    if (decryptedData) {
      try {
        const storageKey = 'stellarcred:credentials';
        const existing = localStorage.getItem(storageKey);
        let credArray = [];
        
        if (existing) {
          credArray = JSON.parse(existing);
        }
        
        credArray.push(JSON.parse(decryptedData));
        
        localStorage.setItem(storageKey, JSON.stringify(credArray));
        setIsSaved(true);
        setError(null);
      } catch (e) {
        setError('Failed to save credential. Invalid format.');
      }
    }
  };

  const resetScanner = () => {
    setScanResult(null);
    setIsEncrypted(false);
    setDecryptedData(null);
    setPassphrase('');
    setError(null);
    setIsSaved(false);
  };

  return (
    <div className="mx-auto max-w-2xl p-8 space-y-8">
      <h1 className="text-3xl font-bold text-center text-gray-800">Scan QR Code</h1>
      
      {!scanResult ? (
        <div className="p-6 border rounded-lg shadow-sm bg-white">
          <div className="aspect-square w-full bg-gray-100 rounded-lg overflow-hidden relative">
            <Scanner
              onScan={(result) => handleScan(result?.[0]?.rawValue ?? null)}
              onError={(err) => setError(err.message)}
              constraints={{ facingMode: 'environment' }}
              classNames={{ container: 'w-full h-full' }}
            />
          </div>
          {error && <p className="text-red-500 mt-4 text-center">{error}</p>}
        </div>
      ) : (
        <div className="p-6 border rounded-lg shadow-sm space-y-4 bg-white">
          <h2 className="text-xl font-semibold text-gray-800">QR Code Scanned</h2>
          
          {isEncrypted ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">This credential is encrypted. Enter the passphrase to decrypt it.</p>
              <input 
                type="password"
                className="w-full p-2 border rounded text-gray-800"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase"
              />
              <button 
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors w-full"
                onClick={handleDecrypt}
              >
                Decrypt Credential
              </button>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              
              {decryptedData && (
                <div className="space-y-4">
                  <div>
                    <p className="font-medium mb-1 text-gray-700">Decrypted Credential:</p>
                    <pre className="p-4 bg-gray-100 rounded text-sm overflow-auto text-gray-800">{decryptedData}</pre>
                  </div>
                  
                  {!isSaved ? (
                    <button 
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors w-full"
                      onClick={handleSaveCredential}
                    >
                      Save & Import Credential
                    </button>
                  ) : (
                    <p className="text-green-600 font-medium text-center">✓ Credential successfully imported to device!</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Verify Request Deep Link:</p>
              <p className="p-4 bg-gray-100 rounded break-all text-sm font-mono text-gray-800">{scanResult}</p>
            </div>
          )}

          <button 
            className="text-sm text-blue-600 hover:underline mt-4"
            onClick={resetScanner}
          >
            Scan Again
          </button>
        </div>
      )}
    </div>
  );
}