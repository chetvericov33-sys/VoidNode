'use strict';
const assert = require('assert');
const { extractText, requestOpenRouterCompletion } = require('./ai_completion');

function response(status, body) {
    return { ok: status >= 200 && status < 300, status: status, statusText: 'test', text: async function() { return JSON.stringify(body); } };
}
(async function() {
    assert.strictEqual(extractText('  hello  '), 'hello');
    assert.strictEqual(extractText([{type:'text',text:'hello '},{type:'text',text:'world'}]), 'hello world');
    assert.strictEqual(extractText(null), '');

    var calls = [];
    var result = await requestOpenRouterCompletion({
        apiKey:'test', primaryModel:'openrouter/free', fallbackModels:[],
        messages:[], fetchWithTimeout: async function(url, opts) {
            calls.push(JSON.parse(opts.body).model);
            return calls.length === 1
                ? response(200,{model:'free/model-a',choices:[{message:{content:''}}]})
                : response(200,{model:'free/model-b',choices:[{message:{content:'Recovered answer'}}]});
        }
    });
    assert.strictEqual(result.answer,'Recovered answer');
    assert.strictEqual(result.model,'free/model-b');
    assert.strictEqual(result.attempts,2);
    assert.strictEqual(calls.length,2);

    var fallbackCalls = [];
    result = await requestOpenRouterCompletion({
        apiKey:'test', primaryModel:'provider/model-a', fallbackModels:['provider/model-b'],
        messages:[], fetchWithTimeout: async function(url, opts) {
            fallbackCalls.push(JSON.parse(opts.body).model);
            return fallbackCalls.length === 1
                ? response(503,{error:{message:'temporary'}})
                : response(200,{model:'provider/model-b',choices:[{message:{content:[{type:'text',text:'Fallback answer'}]}}]});
        }
    });
    assert.deepStrictEqual(fallbackCalls,['provider/model-a','provider/model-b']);
    assert.strictEqual(result.answer,'Fallback answer');

    var attempts = 0;
    await assert.rejects(requestOpenRouterCompletion({
        apiKey:'test', primaryModel:'provider/model-a', fallbackModels:[],
        messages:[], fetchWithTimeout: async function() {
            attempts++;
            return response(401,{error:{message:'unauthorized'}});
        }
    }), /unavailable/);
    assert.strictEqual(attempts,1);
    console.log('AI COMPLETION TESTS: PASS');
})().catch(function(error) { console.error(error); process.exit(1); });
