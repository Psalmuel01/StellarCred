const { xdr, scValToNative } = require('@stellar/stellar-sdk');

function stringifyIfObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.toString === 'function') return value.toString();
  return String(value);
}

function extractInvocation(envelopeXdrBase64) {
  const envelope = xdr.TransactionEnvelope.fromXDR(envelopeXdrBase64, 'base64');
  let tx;
  const kind = envelope.switch().name;

  if (kind === 'envelopeTypeTx') {
    tx = envelope.v1().tx();
  } else if (kind === 'envelopeTypeTxFeeBump') {
    tx = envelope.feeBump().tx().innerTx().v1().tx();
  } else {
    return null;
  }

  const operations = tx.operations();
  for (const op of operations) {
    const body = op.body();
    if (body.switch().name !== 'invokeHostFunction') continue;
    const hostFn = body.invokeHostFunctionOp().hostFunction();
    if (hostFn.switch().name !== 'hostFunctionTypeInvokeContract') continue;
    const invoke = hostFn.invokeContract();
    const functionName = stringifyIfObject(invoke.functionName());
    const args = invoke.args().map(function (argScVal) {
      return scValToNative(argScVal);
    });
    return { functionName: functionName, args: args };
  }
  return null;
}

module.exports = { extractInvocation: extractInvocation, stringifyIfObject: stringifyIfObject };
