// Node 端测试运行器(同 fixture 同测试,验证逻辑正确)
// 浏览器端测试由 Projects/tests-tts.html 运行,二者共用同一 fixture
// 用法: node Projects/run-tests-node.mjs
import { MiMoTTS } from './tests-tts-fixture.js';

// === Polyfills (Node 18+ 自带 atob/btoa,Blob,fetch,AbortController) ===
// fetch 在 Node 18+ 是实验性的;若未启用,降级到 mock
if (typeof fetch === 'undefined') {
  globalThis.fetch = async () => { throw new Error('fetch not available in node'); };
}

const results = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => results.push({name, status: 'pass'}),
                    e => results.push({name, status: 'fail', error: e.message}));
    }
    results.push({name, status: 'pass'});
  } catch (e) {
    results.push({name, status: 'fail', error: e.message});
  }
}
function assertEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}
function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// === 同步运行所有测试 ===
async function run() {
  // --- buildSynthesizePayload ---
  test('buildSynthesizePayload: 完整字段', () => {
    const p = MiMoTTS.buildSynthesizePayload('你好', 'Chloe', '用开心的语气');
    assertEqual(p.model, 'mimo-v2.5-tts');
    assertEqual(p.messages.length, 2);
    assertEqual(p.messages[0], {role: 'user', content: '用开心的语气'});
    assertEqual(p.messages[1], {role: 'assistant', content: '你好'});
    assertEqual(p.audio, {format: 'wav', voice: 'Chloe'});
    assertEqual(p.stream, false);
  });
  test('buildSynthesizePayload: styleDesc 为空时使用 fallback', () => {
    const p = MiMoTTS.buildSynthesizePayload('你好', 'Chloe', '');
    assertEqual(p.messages[0].content, '用自然的语气说');
  });
  test('buildSynthesizePayload: styleDesc 为 null 时使用 fallback', () => {
    const p = MiMoTTS.buildSynthesizePayload('你好', 'Chloe', null);
    assertEqual(p.messages[0].content, '用自然的语气说');
  });

  // --- buildVoiceDesignPayload ---
  test('buildVoiceDesignPayload: 默认 optimizeText=true', () => {
    const p = MiMoTTS.buildVoiceDesignPayload('年轻女声', '示例文本');
    assertEqual(p.model, 'mimo-v2.5-tts-voicedesign');
    assertEqual(p.messages[0], {role: 'user', content: '年轻女声'});
    assertEqual(p.messages[1], {role: 'assistant', content: '示例文本'});
    assertEqual(p.audio, {format: 'wav', optimize_text_preview: true});
    assertEqual(p.stream, false);
  });
  test('buildVoiceDesignPayload: optimizeText=false 显式传', () => {
    const p = MiMoTTS.buildVoiceDesignPayload('老男人', '短句', false);
    assertEqual(p.audio.optimize_text_preview, false);
  });

  // --- buildVoiceClonePayload ---
  test('buildVoiceClonePayload: 默认 wav mime + 正确前缀', () => {
    const p = MiMoTTS.buildVoiceClonePayload('文本', 'BASE64DATA', 'audio/wav');
    assertEqual(p.model, 'mimo-v2.5-tts-voiceclone');
    assertEqual(p.messages[0], {role: 'user', content: ''});
    assertEqual(p.messages[1], {role: 'assistant', content: '文本'});
    assertEqual(p.audio.voice, 'data:audio/wav;base64,BASE64DATA');
    assertEqual(p.audio.format, 'wav');
    assertEqual(p.stream, false);
  });
  test('buildVoiceClonePayload: mp3 mime 透传', () => {
    const p = MiMoTTS.buildVoiceClonePayload('文本', 'XXX', 'audio/mpeg');
    assertEqual(p.audio.voice.startsWith('data:audio/mpeg;base64,'), true);
  });

  // --- parseAudioResponse ---
  await test('parseAudioResponse: 合法 JSON 提取 base64', async () => {
    const fakeData = 'fake audio data';
    const fakeBase64 = Buffer.from(fakeData).toString('base64');
    const json = {choices: [{message: {audio: {data: fakeBase64}}}]};
    const blob = await MiMoTTS.parseAudioResponse(json);
    assertEqual(blob instanceof Blob, true);
    assertEqual(blob.type, 'audio/wav');
    assertEqual(blob.size, fakeData.length);  // 解码后字节数
  });
  await test('parseAudioResponse: 缺 choices 抛错', async () => {
    let threw = false;
    try { await MiMoTTS.parseAudioResponse({}); } catch (e) { threw = true; }
    assert(threw, '应该抛错');
  });
  await test('parseAudioResponse: 缺 audio.data 抛错', async () => {
    let threw = false;
    try { await MiMoTTS.parseAudioResponse({choices: [{message: {}}]}); } catch (e) { threw = true; }
    assert(threw, '应该抛错');
  });

  // --- withRetry ---
  await test('withRetry: 第一次成功 → 1 次调用', async () => {
    let calls = 0;
    const result = await MiMoTTS.withRetry(async () => {
      calls++;
      return {ok: true, status: 200};
    });
    assertEqual(calls, 1);
    assertEqual(result.status, 200);
  });
  await test('withRetry: 503 重试 1 次后成功 → 2 次调用', async () => {
    let calls = 0;
    const result = await MiMoTTS.withRetry(async () => {
      calls++;
      return calls >= 2 ? {ok: true, status: 200} : {ok: false, status: 503};
    });
    assertEqual(calls, 2);
    assertEqual(result.status, 200);
  });
  await test('withRetry: 500 不重试 → 1 次调用,返回 response', async () => {
    let calls = 0;
    const result = await MiMoTTS.withRetry(async () => {
      calls++;
      return {ok: false, status: 500};
    });
    assertEqual(calls, 1);
    assertEqual(result.status, 500);
  });
  await test('withRetry: POST_RETRY_ENABLED=false 时 502 也不重试', async () => {
    const orig = MiMoTTS.POST_RETRY_ENABLED;
    MiMoTTS.POST_RETRY_ENABLED = false;
    let calls = 0;
    const result = await MiMoTTS.withRetry(async () => {
      calls++;
      return {ok: false, status: 502};
    });
    MiMoTTS.POST_RETRY_ENABLED = orig;
    assertEqual(calls, 1);
    assertEqual(result.status, 502);
  });

  // --- synthesize ---
  await test('MiMoTTS.synthesize: 401 抛鉴权失败', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({})});
    let err = null;
    try { await MiMoTTS.synthesize('bad-key', {}, new AbortController().signal); }
    catch (e) { err = e; }
    globalThis.fetch = orig;
    assert(err !== null, '应该抛错');
    assert(err.message.includes('鉴权失败'), `message 应含"鉴权失败",实际: ${err.message}`);
  });
  await test('MiMoTTS.synthesize: 429 抛频繁', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ok: false, status: 429, json: async () => ({})});
    let err = null;
    try { await MiMoTTS.synthesize('k', {}, new AbortController().signal); }
    catch (e) { err = e; }
    globalThis.fetch = orig;
    assert(err.message.includes('频繁'), `message 应含"频繁",实际: ${err.message}`);
  });
  await test('MiMoTTS.synthesize: 200 返回 Blob', async () => {
    const orig = globalThis.fetch;
    const fakeData = 'audio';
    const fakeBase64 = Buffer.from(fakeData).toString('base64');
    globalThis.fetch = async () => ({ok: true, status: 200, json: async () => ({choices: [{message: {audio: {data: fakeBase64}}}]})});
    const blob = await MiMoTTS.synthesize('k', {}, new AbortController().signal);
    globalThis.fetch = orig;
    assertEqual(blob.size, fakeData.length);
  });
  await test('MiMoTTS.synthesize: 网络异常抛网络错误', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    let err = null;
    try { await MiMoTTS.synthesize('k', {}, new AbortController().signal); }
    catch (e) { err = e; }
    globalThis.fetch = orig;
    assert(err.message.includes('网络错误'), `message 应含"网络错误",实际: ${err.message}`);
  });
  await test('MiMoTTS.synthesize: 携带正确 headers 与 body', async () => {
    const orig = globalThis.fetch;
    let captured = null;
    globalThis.fetch = async (url, opts) => { captured = {url, opts}; return {ok: true, status: 200, json: async () => ({choices: [{message: {audio: {data: Buffer.from('x').toString('base64')}}}]})}; };
    await MiMoTTS.synthesize('my-key', {model:'mimo-v2.5-tts', messages:[], audio:{format:'wav', voice:'Chloe'}, stream:false}, new AbortController().signal);
    globalThis.fetch = orig;
    assertEqual(captured.url, 'https://api.xiaomimimo.com/v1/chat/completions');
    assertEqual(captured.opts.method, 'POST');
    assertEqual(captured.opts.headers['api-key'], 'my-key');
    assertEqual(captured.opts.headers['Content-Type'], 'application/json');
  });

  // === 报告 ===
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.length - passed;
  results.forEach(r => {
    const tag = r.status === 'pass' ? '✓' : '✗';
    console.log(`[${tag}] ${r.name}${r.error ? ' — ' + r.error : ''}`);
  });
  console.log(`\n通过 ${passed} / 失败 ${failed} / 总计 ${results.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
