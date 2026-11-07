'use strict';

const assert = require('node:assert/strict');
const { classifyEtherscanVerification, createContractCheckFailure } = require('./contract_check');

assert.equal(classifyEtherscanVerification({ status: '1', result: '[{"type":"function"}]' }), true);
assert.equal(classifyEtherscanVerification({ status: '0', result: 'Contract source code not verified' }), false);
assert.equal(classifyEtherscanVerification({ status: '0', result: 'NOTOK' }), null);
assert.equal(classifyEtherscanVerification({ status: '0', result: 'Max rate limit reached' }), null);
assert.equal(classifyEtherscanVerification({ message: 'NOTOK' }), null);
assert.equal(classifyEtherscanVerification(null), null);

const failure = createContractCheckFailure('0x' + '1'.repeat(40));
assert.equal(failure.isVerified, null);
assert.equal(failure.isHoneypot, null);
assert.equal(failure.canSell, null);
assert.equal(failure.canBuy, null);
assert.equal(failure.ownershipRenounced, null);
assert.equal(failure.liquidityLocked, null);
assert.equal(failure.riskScore, null);
assert.match(failure.riskLevel, /UNKNOWN/);
assert.ok(failure.warnings.length > 0);

console.log('CONTRACT CHECK TEST: PASS');
