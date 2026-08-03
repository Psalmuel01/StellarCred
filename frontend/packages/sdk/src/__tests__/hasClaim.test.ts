import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasClaim, configure } from '../index';
import { scValToNative } from '@stellar/stellar-sdk';

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

describe('hasClaim - expired credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configure({ registryId: 'CDEF1234', rpcUrl: 'http://localhost' });
  });

  it('returns false when is_verified reports the claim as expired', async () => {
    (scValToNative as any).mockReturnValue([false, 1000n, 1000n]);
    const result = await hasClaim('GABC123', 'kyc');
    expect(result).toBe(false);
  });

  it('returns true when is_verified reports a valid, unexpired claim', async () => {
    (scValToNative as any).mockReturnValue([true, 1000n, 9999n]);
    const result = await hasClaim('GABC123', 'kyc');
    expect(result).toBe(true);
  });

  it('returns false when is_verified reports expiry in the past', async () => {
    (scValToNative as any).mockReturnValue([false, 500n, 500n]);
    const result = await hasClaim('GABC123', 'kyc');
    expect(result).toBe(false);
  });
});
