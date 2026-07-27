'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Scanner } from '@yudiel/react-qr-scanner';
import { decryptPayload } from '@/lib/cryptos';

export default function VerifyPage() {
  const router = useRouter();
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [decryptedData, setDecryptedData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = (data: string | null) => {
    if (data && !scanResult) {
      setScanResult(data);
      // Check for structured encrypted JSON envelope
      try {
        const envelope = JSON.parse(data);
        if (envelope.encrypted && envelope.ciphertext) {
          setIsEncrypted(true);
          return;
        }
      } catch {
        // Not JSON, proceed to deep link handling
      }
      
      // Navigate to the scanned deep link
      try {
        const url = new URL(data);
        router.push(url.pathname + url.search);
      } catch {
        setError('Invalid deep link format.');
      }
    }
  };

  const handleDecrypt = () => {
    setError(null);
    try {
      if (!scanResult) throw new Error('No data scanned.');
      const payload = decryptPayload(scanResult, passphrase);
      setDecryptedData(JSON.stringify(payload, null, 2));
    } catch (e) {
      setError('Decryption failed. Invalid passphrase or corrupted data.');
    }
  };

  const resetScanner = () => {
    setScanResult(null);
    setIsEncrypted(false);
    setDecryptedData(null);
    setPassphrase('');
    setError(null);
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
              classNames={{ container: "w-full h-full" }}
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
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                onClick={handleDecrypt}
              >
                Decrypt Credential
              </button>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              {decryptedData && (
                <div>
                  <p className="font-medium mb-1 text-gray-700">Decrypted Credential:</p>
                  <pre className="p-4 bg-gray-100 rounded text-sm overflow-auto text-gray-800">{decryptedData}</pre>
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