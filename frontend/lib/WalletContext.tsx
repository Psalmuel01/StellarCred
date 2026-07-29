'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  AlbedoModule,
  xBullModule,
  type ISupportedWallet,
} from '@creit.tech/stellar-wallets-kit';

interface WalletContextType {
  address: string | null;
  selectedWalletId: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string) => Promise<string>;
}
// Initialize kit with supported Stellar modules
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: 'freighter',
  modules: [
    new FreighterModule(),
    new AlbedoModule(),
    new xBullModule(),
  ],
  allowWalletConnect: true,
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo-project-id',
} as any);
const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);

  useEffect(() => {
    // Restore session on mount if wallet ID exists in localStorage
    const savedWallet = localStorage.getItem('stellar_wallet_id');
    if (savedWallet) {
      kit.setWallet(savedWallet);
      kit
        .getAddress()
        .then((res) => {
          if (res?.address) {
            setAddress(res.address);
            setSelectedWalletId(savedWallet);
          }
        })
        .catch(() => {
          localStorage.removeItem('stellar_wallet_id');
        });
    }
  }, []);

  const connect = async () => {
    try {
      await kit.openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          kit.setWallet(option.id);
          const res = await kit.getAddress();
          if (res?.address) {
            setAddress(res.address);
            setSelectedWalletId(option.id);
            localStorage.setItem('stellar_wallet_id', option.id);
          }
        },
      });
    } catch (error) {
      console.error('Wallet connection cancelled or failed:', error);
    }
  };

  const disconnect = async () => {
    try {
      await kit.disconnect();
      setAddress(null);
      setSelectedWalletId(null);
      localStorage.removeItem('stellar_wallet_id');
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  };

  const signTransaction = async (xdr: string): Promise<string> => {
    if (!address) throw new Error('Wallet not connected');

    // The StellarWalletsKit typings may not expose a generic `sign` method;
    // cast to any to call the runtime method provided by the kit.
    const res = await (kit as any).sign({
      xdr,
      publicKey: address,
      network: WalletNetwork.TESTNET,
    });

    return (res as any).signedXDR || (res as any).result || (res as string);
  };

  return (
    <WalletContext.Provider
      value={{
        address,
        selectedWalletId,
        isConnected: Boolean(address),
        connect,
        disconnect,
        signTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = (): WalletContextType => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};