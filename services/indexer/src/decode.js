const { scValToNative, xdr } = require('@stellar/stellar-sdk');

function decodeScVal(base64Val) {
  return scValToNative(xdr.ScVal.fromXDR(base64Val, 'base64'));
}

function stringifyIfObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.toString === 'function') return value.toString();
  return String(value);
}

function decodeTopics(topics) {
  return (topics || []).map(decodeScVal);
}

function parseEvent(rawEvent) {
  const topics = decodeTopics(rawEvent.topic);
  const topicNames = topics.map(stringifyIfObject);

  const base = {
    ledgerSequence: rawEvent.ledger,
    txHash: rawEvent.txHash,
    eventId: rawEvent.id,
  };

  if (topicNames.length === 1 && topicNames[0] === 'revoked') {
    let data;
    try {
      data = decodeScVal(rawEvent.value);
    } catch (err) {
      return null;
    }
    const parts = Array.isArray(data) ? data : [];
    const holder = parts[0];
    const credentialType = parts[1];
    const issuer = parts[2];
    return {
      ledgerSequence: base.ledgerSequence,
      txHash: base.txHash,
      eventId: base.eventId,
      action: 'revoked',
      wallet: stringifyIfObject(holder),
      credentialType: stringifyIfObject(credentialType),
      issuer: stringifyIfObject(issuer),
      expiryLedgerTime: null,
      needsEnrichment: false,
    };
  }

  if (topicNames.length === 2 && topicNames[0] === 'proof' && topicNames[1] === 'verified') {
    let expiry = null;
    try {
      const data = decodeScVal(rawEvent.value);
      if (data !== null && data !== undefined) {
        expiry = Number(data);
      }
    } catch (err) {
      expiry = null;
    }
    return {
      ledgerSequence: base.ledgerSequence,
      txHash: base.txHash,
      eventId: base.eventId,
      action: 'verified',
      wallet: null,
      credentialType: null,
      issuer: null,
      expiryLedgerTime: expiry,
      needsEnrichment: true,
    };
  }

  return null;
}

module.exports = { parseEvent };
