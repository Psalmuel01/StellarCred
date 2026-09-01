import { safeGetItem, safeSetItem } from "./safe-storage";

export const PROOF_QUEUE_KEY = "stellarcred:proof-queue";
export interface QueuedProofIntent {
  holder: string;
  issuerId: string;
  credentialType: string;
  commitment: string;
  ttlSecs: number;
  queuedAt: number;
}

function read(): QueuedProofIntent[] {
  try { return JSON.parse(safeGetItem(PROOF_QUEUE_KEY) ?? "[]") as QueuedProofIntent[]; }
  catch { return []; }
}
function write(items: QueuedProofIntent[]) { safeSetItem(PROOF_QUEUE_KEY, JSON.stringify(items)); }

/** Queue only the credential commitment and public submission metadata. Proof bytes and secrets never enter persistent storage. */
export async function enqueueProof(intent: Omit<QueuedProofIntent, "queuedAt">): Promise<void> {
  const items = read();
  if (!items.some((item) => item.commitment === intent.commitment && item.holder === intent.holder)) {
    write([...items, { ...intent, queuedAt: Date.now() }]);
  }
}
export function queuedProofCount(): number { return read().length; }
export function queuedProofs(): QueuedProofIntent[] { return read(); }

/** Flushes intents once online. The callback must regenerate the proof from local credential storage. */
export async function flushQueuedProofs(
  submit: (intent: QueuedProofIntent) => Promise<unknown>,
): Promise<void> {
  for (const intent of read()) {
    await submit(intent);
    write(read().filter((item) => !(item.commitment === intent.commitment && item.holder === intent.holder)));
  }
}
