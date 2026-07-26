import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasClaim } from '../index';

// Mock the Stellar SDK to avoid real network calls
vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      getAccount: vi.fn().mockResolvedValue({
        accountId: vi.fn().mockReturnValue('G123'),
        sequenceNumber: vi.fn().mockReturnValue('1'),
      }),
      simulateTransaction: vi.fn(),
    })),
    Api: {
      isSimulationError: vi.fn().mockReturnValue(false),
    },
  },
  TransactionBuilder: vi.fn().mockImplementation(() => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({}),
  })),
  Contract: vi.fn().mockImplementation(() => ({
    call: vi.fn().mockReturnValue({}),
  })),
  Address: {
    fromString: vi.fn().mockReturnValue({
      toScVal: vi.fn().mockReturnValue({}),
    }),
  },
  nativeToScVal: vi.fn().mockReturnValue({}),
  scValToNative: vi.fn(),
  BASE_FEE: '100',
}));

const { scValToNative } = await import('@stellar/stellar-sdk');

describe('hasClaim - expired credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set config for tests
    const { configure } = require('../index');
    configure({ registryId: 'CDEF1234', rpcUrl: 'http://localhost' });
  });

  it('returns false when is_verified reports the claim as expired', async () => {
    // Mock is_verified returning (false, 1000, 1000) — expired
    (scValToNative as any).mockReturnValue([false, 1000n, 1000n]);

    const result = await hasClaim('GABC123', 'kyc');
    expect(result).toBe(false);
  });

  it('returns false when is_verified reports expiry <= current time', async () => {
    // Mock is_verified returning (false, 500, 500) — expired with past timestamp
    (scValToNative as any).mockReturnValue([false, 500n, 500n]);

    const result = await hasClaim('GABC123', 'kyc');
    expect(result).toBe(false);
  });
});
