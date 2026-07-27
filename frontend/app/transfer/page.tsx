'use client';

import { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { encryptPayload } from '../../lib/cryptos';

export default function TransferPage() {
  const [credentialData, setCredentialData] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [encryptedQrData, setEncryptedQrData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Generate the unencrypted verify deep-link
  // In a real app, returnUrl and claimType would be dynamic
  const verifyDeepLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/verify?claimType=ProofOfHumanity&returnUrl=/success`;

  const handleGenerateTransferQR = async () => {
    setError(null);
    if (!credentialData || !passphrase) {
      setError('Please provide both credential data and a passphrase.');
      return;
    }
    
    try {
      const payload = JSON.parse(credentialData) as Record<string, unknown>;
      const encrypted = await encryptPayload(payload, passphrase);
      setEncryptedQrData(encrypted);
    } catch (e) {
      setError('Invalid credential JSON format.');
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-8 space-y-12">
      <section className="p-6 border rounded-lg shadow-sm bg-white">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">Verify Request QR</h2>
        <p className="text-gray-600 mb-4">Scan this QR code with your mobile device to open the verification request.</p>
        <div className="flex justify-center p-4 bg-white rounded-lg">
          <QRCodeCanvas value={verifyDeepLink} size={256} fgColor="#000000" bgColor="#ffffff" />
        </div>
      </section>

      <section className="p-6 border rounded-lg shadow-sm bg-white">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">Credential Transfer QR</h2>
        <p className="text-gray-600 mb-4">Transfer your credential to another device securely. The payload will be encrypted with your passphrase.</p>
        
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Credential Data (JSON)</label>
            <textarea 
              className="w-full p-2 border rounded font-mono text-sm text-gray-800"
              rows={4}
              value={credentialData}
              onChange={(e) => setCredentialData(e.target.value)}
              placeholder='{"id":"123","type":"ProofOfHumanity","secret":"my_secret"}'
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Passphrase</label>
            <input 
              type="password"
              className="w-full p-2 border rounded text-gray-800"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter a secure passphrase"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button 
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            onClick={handleGenerateTransferQR}
          >
            Generate Encrypted QR
          </button>
        </div>

        {encryptedQrData && (
          <div className="flex flex-col items-center p-4 bg-white rounded-lg">
            <QRCodeCanvas value={encryptedQrData} size={256} fgColor="#000000" bgColor="#ffffff" />
            <p className="text-xs text-gray-500 mt-2 text-center max-w-xs">
              Do not share this QR code publicly. Only someone with the passphrase can read the credential.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
