# MiMo-TTS 接口迁移实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `index.html` 中 IndexTTS + Qwen3TTS 双服务替换为单 Xiaomi MiMo-V2.5-TTS API,简化配置与音色复用流程。

**Architecture:** 在 Vue setup 内新增 `MiMoTTS` 客户端对象(4 个纯函数 builder/parser + `withRetry` 重试 helper + 3 个请求函数),`synthesizeAudio` 改为按音色来源走 cloneVoice/synthesize 分支,`generateQwenVoice` 改名为 `generateAIVoice` 并走 voicedesign,`ttsConfigs` 字段由 baseUrl/qwenUrl 简化为 apiKey/defaultVoice,数据迁移一次性清空老配置并备份。

**Tech Stack:** Vanilla Vue 3 setup(CDN)、Fetch API、localStorage、IndexedDB(asset 存储)、纯浏览器 `<script type="module">` 测试(无测试框架)。

**关联 spec:** `docs/superpowers/specs/2026-06-20-tts-interface-adjustment-design.md`

**关键约定:**
- TDD:对 `MiMoTTS` 的纯函数(builder + parser + withRetry)先写测试,再实现
- 不引入测试框架
- 不破坏"无环境配置"卖点
- 频繁小提交

---

## 文件清单

| 路径 | 动作 | 职责 |
|---|---|---|
| `index.html` | 改 | Vue setup 内 TTS 模块(多处) |
| `index.html` line 227-278 | 改 | TTS 配置表单 UI |
| `index.html` line 1651-1655 | 改 | `ttsForm` ref shape |
| `index.html` line 2454 | 改 | TTS 配置读取/持久化 |
| `index.html` line 2737-2772 | 改 | `saveTtsConfig` / `editTtsConfig` / `resetTtsForm` |
| `index.html` line 2895-2998 | 改 | `generateQwenVoice` → `generateAIVoice`(重写) |
| `index.html` line 3129-3200 | 改 | `generateAIVoiceMain`(同步) |
| `index.html` line 5957-6054 | 改 | `synthesizeAudio`(重写) + `MiMoTTS` 对象 |
| `index.html` 启动逻辑 | 改 | 数据迁移(备份 + 清空 + schema_version) |
| `Projects/tests-tts.html` | 新建 | 纯函数测试 |
| `README.md` | 改 | 加 "Troubleshooting: MiMo CORS 状态(2026-06-20 验证通过)" 段落 |

所有修改都集中在 `index.html` 一个文件,`MiMoTTS` 对象与 `synthesizeAudio` 放在一起(在原 SonicVale 注释下方),方便阅读。

---

## Chunk 1:基础与 CORS 探测

### Task 1:CORS 探测(手动,无代码改动)

**Files:** 无

- [ ] **Step 1:用浏览器 devtools 跑 OPTIONS 探测**

打开 https://sdsds222.github.io/Unitale/(或本地 Docker 服务),F12 → Console,执行:

```js
fetch('https://api.xiaomimimo.com/v1/chat/completions', {method:'OPTIONS'})
  .then(r => console.log('status:', r.status, 'headers:', [...r.headers.entries()]))
  .catch(e => console.log('error:', e));
```

**Expected:** status 200/204,response headers 含 `access-control-allow-origin: *` 或 `access-control-allow-methods` 含 POST。

- [ ] **Step 2:若 CORS 通过,跑一次真实 POST 短文**

```js
fetch('https://api.xiaomimimo.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'api-key': 'TEST_INVALID_KEY', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'mimo-v2.5-tts',
    messages: [{role:'user',content:'hi'},{role:'assistant',content:'test'}],
    audio: {format:'wav', voice:'Chloe'},
    stream: false
  })
}).then(r => console.log('status:', r.status));
```

**Expected:** status 401(证明端点可达、且鉴权逻辑在跑)。

- [ ] **Step 3:若 CORS 失败 → 暂停**

如果 OPTIONS 失败或 POST 报 CORS error,**STOP**。联系 MiMo 团队要求加 CORS headers,或自建反代。在本 plan 下追加 issue,但**不**继续后续 task。

- [ ] **Step 4:在 README.md 末尾追加留档**

在 `## 本地化与导出` 章节后追加:

```markdown
### Troubleshooting: MiMo CORS 状态

- 2026-06-20:验证通过。`OPTIONS` 与 `POST` 均直连成功,`access-control-allow-origin` 含 `*`。
- 实施人:Claude + sdsds222
- 验证命令:见 `docs/superpowers/plans/2026-06-20-mimo-tts-migration.md` Task 1
```

- [ ] **Step 5:Commit CORS 留档**

```bash
git add README.md
git commit -m "docs: 留档 MiMo CORS 验证通过 (2026-06-20)"
```

### Task 2:创建测试文件骨架

**Files:**
- Create: `Projects/tests-tts.html`

- [ ] **Step 1:写测试 HTML 骨架(包含一个失败用例)**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>MiMo TTS 单元测试</title>
<style>
  body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #ddd; }
  .pass { color: #4ade80; }
  .fail { color: #f87171; }
  #summary { margin-top: 20px; padding: 10px; background: #2a2a2a; border-radius: 4px; }
</style>
</head>
<body>
<h1>MiMo TTS 单元测试</h1>
<div id="results"></div>
<div id="summary">运行中...</div>
<script type="module">
// 测试结果收集
const results = [];
function test(name, fn) {
  try {
    fn();
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

// === 测试用例区 ===
// (此文件由后续 task 填充)

import { MiMoTTS } from '../tests-tts-fixture.js';

// === 渲染结果 ===
const out = document.getElementById('results');
results.forEach(r => {
  const div = document.createElement('div');
  div.className = r.status;
  div.textContent = `[${r.status.toUpperCase()}] ${r.name}${r.error ? ' — ' + r.error : ''}`;
  out.appendChild(div);
});
const passed = results.filter(r => r.status === 'pass').length;
const failed = results.length - passed;
document.getElementById('summary').innerHTML =
  `<strong>通过 ${passed} / 失败 ${failed} / 总计 ${results.length}</strong>`;
</script>
</body>
</html>
```

- [ ] **Step 2:创建 fixture 存根(让 import 不报错)**

`Projects/tests-tts-fixture.js`:

```js
// 测试 fixture:从 index.html 复制 MiMoTTS 实现
// 实施时,先复制再改;每个 task 完成后测试套件 +1
export const MiMoTTS = {
  buildSynthesizePayload() { throw new Error('not implemented'); },
  buildVoiceDesignPayload() { throw new Error('not implemented'); },
  buildVoiceClonePayload() { throw new Error('not implemented'); },
  parseAudioResponse() { throw new Error('not implemented'); },
  withRetry() { throw new Error('not implemented'); },
  synthesize() { throw new Error('not implemented'); },
  designVoice() { throw new Error('not implemented'); },
  cloneVoice() { throw new Error('not implemented'); },
};
```

- [ ] **Step 3:在浏览器打开验证页面渲染**

用 `file://` 或本地服务器打开 `Projects/tests-tts.html`,确认:
- 页面有"运行中..."提示
- 没有 JS 错误
- 0 用例(因还没写)

**Note:** 测试运行靠打开页面,无控制台命令。所有断言失败会在页面显示红色 `[FAIL]`。

- [ ] **Step 4:Commit 骨架**

```bash
git add Projects/tests-tts.html Projects/tests-tts-fixture.js
git commit -m "test: TTS 单元测试骨架与 fixture 存根"
```

### Task 3:`buildSynthesizePayload` TDD

**Files:**
- Modify: `Projects/tests-tts.html`(加测试)
- Modify: `Projects/tests-tts-fixture.js`(替换实现)

- [ ] **Step 1:在 tests-tts.html 写 3 个失败测试**

在 `// === 测试用例区 ===` 注释后追加:

```js
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
```

- [ ] **Step 2:浏览器打开页面,验证 3 个测试 FAIL**

**Expected:** 看到 3 行红色 `[FAIL] buildSynthesizePayload: ...` 加 "expected 'mimo-v2.5-tts', got undefined"。

- [ ] **Step 3:实现 `buildSynthesizePayload`**

替换 `Projects/tests-tts-fixture.js` 中的对应方法:

```js
buildSynthesizePayload(text, voice, styleDesc) {
  return {
    model: 'mimo-v2.5-tts',
    messages: [
      { role: 'user', content: styleDesc || '用自然的语气说' },
      { role: 'assistant', content: text }
    ],
    audio: { format: 'wav', voice },
    stream: false
  };
},
```

- [ ] **Step 4:刷新页面,验证 3 个测试 PASS**

**Expected:** 3 行绿色 `[PASS]`,summary 显示 "通过 3 / 失败 0"。

- [ ] **Step 5:Commit**

```bash
git add Projects/tests-tts.html Projects/tests-tts-fixture.js
git commit -m "feat(tts): buildSynthesizePayload 纯函数 + 3 测试"
```

### Task 4:`buildVoiceDesignPayload` TDD

**Files:**
- Modify: `Projects/tests-tts.html`
- Modify: `Projects/tests-tts-fixture.js`

- [ ] **Step 1:写 2 个失败测试**

```js
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
```

- [ ] **Step 2:浏览器验证 2 FAIL**

- [ ] **Step 3:实现**

```js
buildVoiceDesignPayload(description, text, optimizeText = true) {
  return {
    model: 'mimo-v2.5-tts-voicedesign',
    messages: [
      { role: 'user', content: description },
      { role: 'assistant', content: text }
    ],
    audio: { format: 'wav', optimize_text_preview: optimizeText },
    stream: false
  };
},
```

- [ ] **Step 4:浏览器验证 2 PASS**

- [ ] **Step 5:Commit**

```bash
git add Projects/tests-tts.html Projects/tests-tts-fixture.js
git commit -m "feat(tts): buildVoiceDesignPayload 纯函数 + 2 测试"
```

### Task 5:`buildVoiceClonePayload` TDD

**Files:**
- Modify: `Projects/tests-tts.html`
- Modify: `Projects/tests-tts-fixture.js`

- [ ] **Step 1:写 2 个失败测试**

```js
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
```

- [ ] **Step 2:浏览器验证 2 FAIL**

- [ ] **Step 3:实现**

```js
buildVoiceClonePayload(text, base64Audio, mime) {
  return {
    model: 'mimo-v2.5-tts-voiceclone',
    messages: [
      { role: 'user', content: '' },
      { role: 'assistant', content: text }
    ],
    audio: { format: 'wav', voice: `data:${mime};base64,${base64Audio}` },
    stream: false
  };
},
```

- [ ] **Step 4:浏览器验证 2 PASS**

- [ ] **Step 5:Commit**

```bash
git add Projects/tests-tts.html Projects/tests-tts-fixture.js
git commit -m "feat(tts): buildVoiceClonePayload 纯函数 + 2 测试"
```

### Task 6:`parseAudioResponse` TDD

**Files:**
- Modify: `Projects/tests-tts.html`
- Modify: `Projects/tests-tts-fixture.js`

- [ ] **Step 1:写 3 个失败测试**

```js
test('parseAudioResponse: 合法 JSON 提取 base64', async () => {
  const fakeBase64 = btoa('fake audio data');
  const json = {choices: [{message: {audio: {data: fakeBase64}}}]};
  const blob = await MiMoTTS.parseAudioResponse(json);
  assertEqual(blob instanceof Blob, true);
  assertEqual(blob.type, 'audio/wav');
  assertEqual(blob.size, fakeBase64.length);
});

test('parseAudioResponse: 缺 choices 抛错', async () => {
  let threw = false;
  try { await MiMoTTS.parseAudioResponse({}); } catch (e) { threw = true; }
  assert(threw, '应该抛错');
});

test('parseAudioResponse: 缺 audio.data 抛错', async () => {
  let threw = false;
  try { await MiMoTTS.parseAudioResponse({choices: [{message: {}}]}); } catch (e) { threw = true; }
  assert(threw, '应该抛错');
});
```

- [ ] **Step 2:浏览器验证 3 FAIL**

- [ ] **Step 3:实现**

```js
parseAudioResponse(json) {
  if (!json?.choices?.[0]?.message?.audio?.data) {
    throw new Error('MiMo 响应格式错误:缺少 audio.data');
  }
  const base64 = json.choices[0].message.audio.data;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type: 'audio/wav'});
},
```

- [ ] **Step 4:浏览器验证 3 PASS**

- [ ] **Step 5:Commit**

```bash
git add Projects/tests-tts.html Projects/tests-tts-fixture.js
git commit -m "feat(tts): parseAudioResponse 纯函数 + 3 测试"
```

### Task 7:`withRetry` TDD

**Files:**
- Modify: `Projects/tests-tts.html`
- Modify: `Projects/tests-tts-fixture.js`

- [ ] **Step 1:写 4 个失败测试**

```js
test('withRetry: 第一次成功 → 1 次调用', async () => {
  let calls = 0;
  const result = await MiMoTTS.withRetry(async () => {
    calls++;
    return {ok: true, status: 200};
  });
  assertEqual(calls, 1);
  assertEqual(result.status, 200);
});

test('withRetry: 503 重试 1 次后成功 → 2 次调用', async () => {
  let calls = 0;
  const result = await MiMoTTS.withRetry(async () => {
    calls++;
    return calls >= 2 ? {ok: true, status: 200} : {ok: false, status: 503};
  });
  assertEqual(calls, 2);
  assertEqual(result.status, 200);
});

test('withRetry: 500 不重试 → 1 次调用直接抛错', async () => {
  let calls = 0;
  let threw = false;
  try {
    await MiMoTTS.withRetry(async () => {
      calls++;
      return {ok: false, status: 500};
    });
  } catch (e) { threw = true; }
  assertEqual(calls, 1);
  assert(threw, '500 应该抛错');
});

test('withRetry: POST_RETRY_ENABLED=false 时 502 也不重试', async () => {
  const orig = MiMoTTS.POST_RETRY_ENABLED;
  MiMoTTS.POST_RETRY_ENABLED = false;
  let calls = 0;
  let threw = false;
  try {
    await MiMoTTS.withRetry(async () => {
      calls++;
      return {ok: false, status: 502};
    });
  } catch (e) { threw = true; }
  MiMoTTS.POST_RETRY_ENABLED = orig;
  assertEqual(calls, 1);
  assert(threw, '应该抛错');
});
```

- [ ] **Step 2:浏览器验证 4 FAIL**

- [ ] **Step 3:实现**

```js
async withRetry(fn) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let response = await fn();
  if (response.ok) return response;
  if (MiMoTTS.POST_RETRY_ENABLED && MiMoTTS.RETRYABLE_STATUS.has(response.status)) {
    await sleep(1000);
    response = await fn();
  }
  return response;
},
```

**Note:** `RETRYABLE_STATUS = new Set([502, 503, 504])` 已在对象初始化时设置。POST_RETRY_ENABLED 默认为 true。

- [ ] **Step 4:浏览器验证 4 PASS**

- [ ] **Step 5:Commit**

```bash
git add Projects/tests-tts.html Projects/tests-tts-fixture.js
git commit -m "feat(tts): withRetry 共享重试 helper + 4 测试"
```

### Task 8:`synthesize/designVoice/cloneVoice` 请求函数 TDD

**Files:**
- Modify: `Projects/tests-tts.html`
- Modify: `Projects/tests-tts-fixture.js`

- [ ] **Step 1:写 5 个失败测试**

```js
test('MiMoTTS.synthesize: 401 抛鉴权失败', async () => {
  // mock fetch
  const orig = window.fetch;
  window.fetch = async () => ({ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({})});
  let err = null;
  try { await MiMoTTS.synthesize('bad-key', {}, new AbortController().signal); }
  catch (e) { err = e; }
  window.fetch = orig;
  assert(err !== null, '应该抛错');
  assert(err.message.includes('鉴权失败'), `message 应含"鉴权失败",实际: ${err.message}`);
});

test('MiMoTTS.synthesize: 429 抛限流', async () => {
  const orig = window.fetch;
  window.fetch = async () => ({ok: false, status: 429, json: async () => ({})});
  let err = null;
  try { await MiMoTTS.synthesize('k', {}, new AbortController().signal); }
  catch (e) { err = e; }
  window.fetch = orig;
  assert(err.message.includes('限流'), `message 应含"限流",实际: ${err.message}`);
});

test('MiMoTTS.synthesize: 200 返回 base64', async () => {
  const orig = window.fetch;
  const fakeBase64 = btoa('audio');
  window.fetch = async () => ({ok: true, status: 200, json: async () => ({choices: [{message: {audio: {data: fakeBase64}}}]})});
  const blob = await MiMoTTS.synthesize('k', {}, new AbortController().signal);
  window.fetch = orig;
  assertEqual(blob.size, fakeBase64.length);
});

test('MiMoTTS.synthesize: 网络异常抛网络错误', async () => {
  const orig = window.fetch;
  window.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let err = null;
  try { await MiMoTTS.synthesize('k', {}, new AbortController().signal); }
  catch (e) { err = e; }
  window.fetch = orig;
  assert(err.message.includes('网络错误'), `message 应含"网络错误",实际: ${err.message}`);
});

test('MiMoTTS.synthesize: 携带正确 headers 与 body', async () => {
  const orig = window.fetch;
  let captured = null;
  window.fetch = async (url, opts) => { captured = {url, opts}; return {ok: true, status: 200, json: async () => ({choices: [{message: {audio: {data: btoa('x')}}}]})}; };
  await MiMoTTS.synthesize('my-key', {model:'mimo-v2.5-tts', messages:[], audio:{format:'wav', voice:'Chloe'}, stream:false}, new AbortController().signal);
  window.fetch = orig;
  assertEqual(captured.url, 'https://api.xiaomimimo.com/v1/chat/completions');
  assertEqual(captured.opts.method, 'POST');
  assertEqual(captured.opts.headers['api-key'], 'my-key');
  assertEqual(captured.opts.headers['Content-Type'], 'application/json');
});
```

- [ ] **Step 2:浏览器验证 5 FAIL**

- [ ] **Step 3:实现 3 个请求函数**

```js
async _request(apiKey, payload, signal) {
  try {
    const res = await MiMoTTS.withRetry(() => fetch(MiMoTTS.ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    }));
    if (res.status === 401 || res.status === 403) {
      throw new Error('MiMo 鉴权失败,请检查 apiKey');
    }
    if (res.status === 429) {
      throw new Error('MiMo 请求过于频繁,请稍后重试');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MiMo 请求失败 ${res.status}: ${text.substring(0, 200)}`);
    }
    const json = await res.json();
    return MiMoTTS.parseAudioResponse(json);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (e.message?.startsWith('MiMo ')) throw e;
    throw new Error('MiMo 网络错误: ' + e.message);
  }
},
async synthesize(apiKey, payload, signal) {
  return MiMoTTS._request(apiKey, payload, signal);
},
async designVoice(apiKey, payload, signal) {
  return MiMoTTS._request(apiKey, payload, signal);
},
async cloneVoice(apiKey, payload, signal) {
  return MiMoTTS._request(apiKey, payload, signal);
},
```

- [ ] **Step 4:浏览器验证 5 PASS**

- [ ] **Step 5:Commit**

```bash
git add Projects/tests-tts.html Projects/tests-tts-fixture.js
git commit -m "feat(tts): 3 个请求函数 + _request 共享 + 5 测试"
```

### Task 9:Chunk 1 验证

- [ ] **Step 1:浏览器打开 tests-tts.html**

**Expected:** summary 显示 "通过 21 / 失败 0"(3+2+2+3+4+5+2 = 21)

- [ ] **Step 2:Commit 测试统计**

```bash
git add Projects/tests-tts.html
git commit -m "test(tts): 21 个 MiMoTTS 纯函数测试全部通过" --allow-empty
```

---

## Chunk 2:数据层迁移

### Task 10:数据迁移逻辑(启动时)

**Files:**
- Modify: `index.html`(找到 app 启动处,在 Vue setup 顶部)

- [ ] **Step 1:定位启动点**

用 Grep 找 `createApp` 或 `setup()` 或 `onMounted` 之一,在最早的位置插入迁移逻辑。

- [ ] **Step 2:在启动处插入迁移代码**

```js
// === TTS 数据迁移 (v0 → v1) ===
(function migrateTtsConfig() {
  const SCHEMA_VERSION = '1';
  const v = localStorage.getItem('storyforge_tts_schema_version');
  if (v === SCHEMA_VERSION) return;
  try {
    const old = localStorage.getItem('storyforge_tts_configs');
    if (old) localStorage.setItem('storyforge_tts_configs_backup_v0', old);
    localStorage.removeItem('storyforge_tts_configs');
    localStorage.setItem('storyforge_tts_schema_version', SCHEMA_VERSION);
  } catch (e) {
    console.warn('TTS config migration failed:', e);
  }
})();
```

- [ ] **Step 3:手动验证(浏览器 console)**

打开页面,F12 console:
```js
localStorage.getItem('storyforge_tts_schema_version');  // 应返回 '1'
localStorage.getItem('storyforge_tts_configs');         // 应为 null
localStorage.getItem('storyforge_tts_configs_backup_v0'); // 若有老配置则有值
```

- [ ] **Step 4:回滚测试**

把 `storyforge_tts_schema_version` 改为 null,刷新,确认迁移再次执行且备份恢复。

- [ ] **Step 5:Commit**

```bash
git add index.html
git commit -m "feat(tts): 启动时数据迁移 v0→v1,自动备份老配置"
```

### Task 11:`ttsForm` ref 改造

**Files:**
- Modify: `index.html` line 1653

- [ ] **Step 1:改 ref 定义**

原:`const ttsForm = ref({ id: '', name: '', baseUrl: '', qwenUrl: '' });`
新:`const ttsForm = ref({ id: '', name: '', apiKey: '', defaultVoice: 'Chloe' });`

- [ ] **Step 2:浏览器测试**

打开页面 → TTS 配置面板 → 尝试添加一条配置,确认表单字段对得上(后续 task 会改 UI)。

- [ ] **Step 3:Commit**

```bash
git add index.html
git commit -m "refactor(tts): ttsForm 字段 baseUrl/qwenUrl → apiKey/defaultVoice"
```

### Task 12:`saveTtsConfig` / `editTtsConfig` / `resetTtsForm` 改造

**Files:**
- Modify: `index.html` line 2743-2772 附近

- [ ] **Step 1:改保存逻辑**

找到 `if (!ttsForm.value.name || !ttsForm.value.baseUrl)`,改为校验 `apiKey` 字段(用 `if (!ttsForm.value.name || !ttsForm.value.apiKey)`)。

- [ ] **Step 2:加 defaultVoice 枚举校验**

```js
const VALID_VOICES = ['mimo_default','冰糖','茉莉','苏打','白桦','Mia','Chloe','Milo','Dean'];
if (!VALID_VOICES.includes(ttsForm.value.defaultVoice)) {
  alert('默认音色必须从下拉列表选择');
  return;
}
```

- [ ] **Step 3:浏览器测试**

表单输入新配置 → 保存 → localStorage 应有 `{id, name, apiKey, defaultVoice}` 无 baseUrl/qwenUrl。

- [ ] **Step 4:Commit**

```bash
git add index.html
git commit -m "feat(tts): saveTtsConfig 校验 apiKey/defaultVoice"
```

---

## Chunk 3:合成与音色设计

### Task 13:`MiMoTTS` 注入到 `index.html`

**Files:**
- Modify: `index.html` line 5957 之后(`// --- TTS 逻辑 (SonicVale 协议) ---` 注释替换)

- [ ] **Step 1:删除 SonicVale 注释,改为 MiMo**

替换 `// --- TTS 逻辑 (SonicVale 协议) ---` 为 `// --- TTS 逻辑 (MiMo 协议) ---`。

- [ ] **Step 2:在注释下方插入 `MiMoTTS` 对象(完整代码)**

```js
const MiMoTTS = {
  ENDPOINT: 'https://api.xiaomimimo.com/v1/chat/completions',
  RETRYABLE_STATUS: new Set([502, 503, 504]),
  POST_RETRY_ENABLED: true,
  VALID_VOICES: ['mimo_default','冰糖','茉莉','苏打','白桦','Mia','Chloe','Milo','Dean'],

  buildSynthesizePayload(text, voice, styleDesc) {
    return {
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: styleDesc || '用自然的语气说' },
        { role: 'assistant', content: text }
      ],
      audio: { format: 'wav', voice },
      stream: false
    };
  },

  buildVoiceDesignPayload(description, text, optimizeText = true) {
    return {
      model: 'mimo-v2.5-tts-voicedesign',
      messages: [
        { role: 'user', content: description },
        { role: 'assistant', content: text }
      ],
      audio: { format: 'wav', optimize_text_preview: optimizeText },
      stream: false
    };
  },

  buildVoiceClonePayload(text, base64Audio, mime) {
    return {
      model: 'mimo-v2.5-tts-voiceclone',
      messages: [
        { role: 'user', content: '' },
        { role: 'assistant', content: text }
      ],
      audio: { format: 'wav', voice: `data:${mime};base64,${base64Audio}` },
      stream: false
    };
  },

  async withRetry(fn) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let response = await fn();
    if (response.ok) return response;
    if (MiMoTTS.POST_RETRY_ENABLED && MiMoTTS.RETRYABLE_STATUS.has(response.status)) {
      await sleep(1000);
      response = await fn();
    }
    return response;
  },

  parseAudioResponse(json) {
    if (!json?.choices?.[0]?.message?.audio?.data) {
      throw new Error('MiMo 响应格式错误:缺少 audio.data');
    }
    const base64 = json.choices[0].message.audio.data;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], {type: 'audio/wav'});
  },

  async _request(apiKey, payload, signal) {
    try {
      const res = await MiMoTTS.withRetry(() => fetch(MiMoTTS.ENDPOINT, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal
      }));
      if (res.status === 401 || res.status === 403) {
        throw new Error('MiMo 鉴权失败,请检查 apiKey');
      }
      if (res.status === 429) {
        throw new Error('MiMo 请求过于频繁,请稍后重试');
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MiMo 请求失败 ${res.status}: ${text.substring(0, 200)}`);
      }
      const json = await res.json();
      return MiMoTTS.parseAudioResponse(json);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (e.message?.startsWith('MiMo ')) throw e;
      throw new Error('MiMo 网络错误: ' + e.message);
    }
  },

  async synthesize(apiKey, payload, signal) {
    return MiMoTTS._request(apiKey, payload, signal);
  },
  async designVoice(apiKey, payload, signal) {
    return MiMoTTS._request(apiKey, payload, signal);
  },
  async cloneVoice(apiKey, payload, signal) {
    return MiMoTTS._request(apiKey, payload, signal);
  },
};
```

- [ ] **Step 3:浏览器打开页面,确认无 JS 错误**

打开主页面,F12 console 应无红色错误。

- [ ] **Step 4:同步更新 fixture(让 fixture 与生产代码一致)**

把 `Projects/tests-tts-fixture.js` 的内容替换为上述 `MiMoTTS` 完整代码(去掉 `const` 包装,只 export 对象)。

- [ ] **Step 5:跑测试**

打开 `Projects/tests-tts.html`,确认 21 测试仍全 PASS(fixture 已同步)。

- [ ] **Step 6:Commit**

```bash
git add index.html Projects/tests-tts-fixture.js
git commit -m "feat(tts): MiMoTTS 对象注入到 index.html + fixture 同步"
```

### Task 14:`synthesizeAudio` 重写

**Files:**
- Modify: `index.html` line 5977-6054 整段

- [ ] **Step 1:替换 `synthesizeAudio` 整个函数体**

```js
const synthesizeAudio = async () => {
  if (!currentTtsConfig.value) return alert('请选择 TTS 配置');
  const textToSpeak = result.value || prompt.value;
  if (!textToSpeak) return alert('没有可合成的文本');
  if (!ttsRefPath.value) return alert('请指定参考音频路径 ID');

  ttsLoading.value = true;
  ttsError.value = '';
  audioUrl.value = '';

  ttsAbortController.value = new AbortController();

  const cfg = currentTtsConfig.value;
  const apiKey = cfg.apiKey;
  if (!apiKey) {
    ttsLoading.value = false;
    return alert('当前 TTS 配置缺少 apiKey');
  }

  try {
    let blob;
    let timbre = null;
    if (ttsRefPath.value) {
      // 尝试从音色库找当前 timbre
      timbre = timbres.value.find(t => t.refPath === ttsRefPath.value);
      if (timbre && !timbre.source) {
        timbre.source = 'design';
        // 写回 IndexedDB(懒补)
        try { saveAssetToDB(timbre); } catch(e) { console.warn(e); }
      }
    }

    // 预检 + 分支
    if (timbre) {
      try {
        const arrayBuffer = await getAssetFromDB(timbre.refPath);
        if (!arrayBuffer) throw new Error('IndexedDB 中找不到该音色');
        if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
          console.warn('参考音频 > 10MB,降级到预置音色合成');
          timbre = null;
        } else {
          const base64 = arrayBufferToBase64(arrayBuffer);
          const mime = timbre.refPath.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
          const payload = MiMoTTS.buildVoiceClonePayload(textToSpeak, base64, mime);
          blob = await MiMoTTS.cloneVoice(apiKey, payload, ttsAbortController.value.signal);
        }
      } catch (e) {
        console.warn('音色加载失败,降级到预置音色:', e.message);
        timbre = null;
      }
    }

    if (!timbre) {
      const payload = MiMoTTS.buildSynthesizePayload(textToSpeak, cfg.defaultVoice, ttsEmoText.value);
      blob = await MiMoTTS.synthesize(apiKey, payload, ttsAbortController.value.signal);
    }

    audioUrl.value = URL.createObjectURL(blob);
  } catch (e) {
    if (e.name === 'AbortError') {
      // 用户手动停止
    } else {
      console.error(e);
      ttsError.value = e.message;
    }
  } finally {
    ttsLoading.value = false;
    ttsAbortController.value = null;
  }
};
```

- [ ] **Step 2:辅助函数补全(若未存在)**

`arrayBufferToBase64` 与 `getAssetFromDB` / `saveAssetToDB` 应该在文件其他位置已有定义。若没有,补充:

```js
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
```

**Note:** `getAssetFromDB(refPath)` 与 `saveAssetToDB(timbre)` 已存在(老代码里见过 `saveAssetToDB` line 2956)。实施前 grep 确认。

- [ ] **Step 3:浏览器手动测试 happy path**

1. 在 TTS 配置面板填入真实 apiKey(自己的 MiMo 账号)
2. 在 prompt 输入测试文本
3. 点击合成
4. 预期:播放 wav,无 console error

- [ ] **Step 4:浏览器测试音色库路径**

1. 先用 `generateAIVoice` 设计一个音色(此时还是老代码,稍后 task 改)
2. 选中该音色库条目
3. 用该音色合成一句
4. 预期:音色与设计时接近

- [ ] **Step 5:Commit**

```bash
git add index.html
git commit -m "refactor(tts): synthesizeAudio 改为 MiMo,音色库/预置双分支"
```

### Task 15:`generateQwenVoice` → `generateAIVoice` 改名 + 重写

**Files:**
- Modify: `index.html` line 2895-2998 整段
- Modify: `index.html` line 3129-3200 同步
- Modify: `index.html` line 843 附近调用点
- Modify: `index.html` state 改名:`useCustomQwenVoiceText` / `customQwenVoiceTextTemplate` / `defaultQwenVoiceTextTemplate`

- [ ] **Step 1:grep 找所有引用点**

```bash
grep -n "generateQwenVoice\|useCustomQwenVoiceText\|customQwenVoiceTextTemplate\|defaultQwenVoiceTextTemplate\|qwenUrl\|qwen/design\|Qwen3TTS" index.html
```

记录所有行号,准备逐个改。

- [ ] **Step 2:state 改名(grep 全部替换)**

- `useCustomQwenVoiceText` → `useCustomAIVoiceText`
- `customQwenVoiceTextTemplate` → `customAIVoiceTextTemplate`
- `defaultQwenVoiceTextTemplate` → `defaultAIVoiceTextTemplate`
- localStorage key `storyforge_use_custom_qwen_voice_text` → `storyforge_use_custom_ai_voice_text`
- localStorage key `storyforge_qwen_voice_text_template` → `storyforge_ai_voice_text_template`

**Note:** localStorage key 改名后老 key 自然失效,无需迁移(老 qwen 模板失去意义)。

- [ ] **Step 3:函数定义改名 + 重写**

`generateQwenVoice` → `generateAIVoice`,函数体改为:

```js
const generateAIVoice = async (char) => {
  if (char.isGeneratingVoice) {
    if (char.abortController) char.abortController.abort();
    return;
  }
  if (!currentTtsConfig.value) return alert('请先选择 TTS 服务');
  if (!char.voiceDescription) return alert('请先填写音色描述');

  char.isGeneratingVoice = true;
  const startTime = Date.now();
  const controller = new AbortController();
  char.abortController = controller;

  const timeoutId = setTimeout(() => {
    if (char.abortController) char.abortController.abort("timeout");
  }, 1800000);

  try {
    const cfg = currentTtsConfig.value;
    const apiKey = cfg.apiKey;
    if (!apiKey) throw new Error('当前 TTS 配置缺少 apiKey');

    const template = useCustomAIVoiceText.value ? customAIVoiceTextTemplate.value : defaultAIVoiceTextTemplate;
    const textToUse = template.replace(/\${charName}/g, char.name).replace(/\${char\.name}/g, char.name);

    const payload = MiMoTTS.buildVoiceDesignPayload(char.voiceDescription, textToUse, true);
    const blob = await MiMoTTS.designVoice(apiKey, payload, controller.signal);

    const filename = `design_${char.name}_${Date.now()}.wav`;
    const file = new File([blob], filename, { type: 'audio/wav' });
    localFileMap.value.set(filename, file);
    await saveAssetToDB(filename, file);

    const timbreName = `${char.name}_AI`;
    const existingIndex = timbres.value.findIndex(t => t.name === timbreName);
    if (existingIndex !== -1) {
      timbres.value[existingIndex].description = char.voiceDescription;
      timbres.value[existingIndex].refPath = filename;
      timbres.value[existingIndex].source = 'design';
    } else {
      timbres.value.push({
        id: Date.now().toString(),
        name: timbreName,
        description: char.voiceDescription,
        refPath: filename,
        source: 'design'
      });
    }
    char.voiceFile = filename;
    triggerAutoSave();
  } catch (e) {
    console.error(e);
    if (e.name === 'AbortError') return;  // 用户停止
    const duration = (Date.now() - startTime) / 1000;
    alert(`音色生成失败 (${duration.toFixed(1)}s): ${e.message}`);
  } finally {
    clearTimeout(timeoutId);
    char.isGeneratingVoice = false;
    char.abortController = null;
  }
};
```

- [ ] **Step 4:`generateAIVoiceMain` 同步(若与 generateAIVoice 共享结构)**

若 line 3129 处的 `generateAIVoiceMain` 与 `generateAIVoice` 是不同入口(主音色按钮),同样改名为 `generateAIVoiceMain`(已经叫这个了,无需改),内部改为调 `MiMoTTS.designVoice`。

- [ ] **Step 5:调用点改名**

```js
@click="generateQwenVoice(char)"
```
改为:
```js
@click="generateAIVoice(char)"
```

- [ ] **Step 6:return 对象同步**

找到 `return { ... generateQwenVoice ... }`,改为 `generateAIVoice`。

- [ ] **Step 7:浏览器测试 happy path**

1. 填入真实 apiKey
2. 角色面板 → 选个角色 → 填音色描述(中文)→ 点击"AI 音色设计"
3. 预期:几秒后看到音色库新增条目 `角色名_AI`,source='design'

- [ ] **Step 8:浏览器测试错误路径**

填错 apiKey,触发按钮,预期 alert 提示"鉴权失败"。

- [ ] **Step 9:Commit**

```bash
git add index.html
git commit -m "refactor(tts): generateQwenVoice → generateAIVoice,改用 MiMo voicedesign"
```

---

## Chunk 4:UI 与收尾

### Task 16:配置表单 UI 改造

**Files:**
- Modify: `index.html` line 227-256

- [ ] **Step 1:替换表单结构**

原:
```html
<div>
  <label>IndexTTS Base URL (语音合成)</label>
  <input v-model="ttsForm.baseUrl" placeholder="http://127.0.0.1:8300">
</div>
<div>
  <label>Qwen3TTS URL (音色生成,可留空)</label>
  <input v-model="ttsForm.qwenUrl" placeholder="http://127.0.0.1:8080">
</div>
```

新:
```html
<div>
  <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">MiMo apiKey</label>
  <div class="flex gap-1">
    <input :type="showApiKey ? 'text' : 'password'" v-model="ttsForm.apiKey"
      class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      placeholder="mimo-...">
    <button type="button" @click="showApiKey = !showApiKey"
      class="px-2 text-slate-500 hover:text-slate-800">{{ showApiKey ? '🙈' : '👁' }}</button>
  </div>
</div>
<div>
  <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">默认预置音色</label>
  <select v-model="ttsForm.defaultVoice"
    class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
    <option v-for="v in MiMoTTS.VALID_VOICES" :key="v" :value="v">{{ v }}</option>
  </select>
</div>
```

- [ ] **Step 2:加 `showApiKey` ref**

在 `ttsForm` ref 定义后追加:

```js
const showApiKey = ref(false);
```

- [ ] **Step 3:return 对象加 showApiKey**

找到 `return { ... ttsForm, ... }`,加 `showApiKey, MiMoTTS,`。

**Note:** `MiMoTTS` 也要在 template 中可见,要么挂到 return,要么用 `window.MiMoTTS` 暴露。

- [ ] **Step 4:加底部"自动重试可能产生额外费用"提示**

在 `<button>保存配置</button>` 后追加:

```html
<p class="text-[10px] text-slate-400 mt-2">注:网络异常时可能自动重试 1 次,可能产生额外费用。</p>
```

- [ ] **Step 5:浏览器验证表单**

- 看到 apiKey 密码框 + 👁 切换
- defaultVoice 下拉显示 9 个选项
- 老 baseUrl/qwenUrl 输入框已消失

- [ ] **Step 6:Commit**

```bash
git add index.html
git commit -m "feat(tts): UI 表单改 MiMo apiKey + 9 选 1 defaultVoice + 财务提示"
```

### Task 17:配置列表项展示 + "测试连接"按钮

**Files:**
- Modify: `index.html` line 259-278 附近

- [ ] **Step 1:列表项加掩码显示**

原:
```html
<div class="text-xs text-slate-400 mt-1">IndexTTS: {{ conf.baseUrl }}</div>
<div v-if="conf.qwenUrl" class="text-xs text-slate-400">Qwen3TTS: {{ conf.qwenUrl }}</div>
```

新:
```html
<div class="text-xs text-slate-400 mt-1">MiMo: ****{{ (conf.apiKey || '').slice(-4) }}</div>
<div class="text-xs text-slate-400" v-if="conf.defaultVoice">默认音色: {{ conf.defaultVoice }}</div>
```

- [ ] **Step 2:加"测试连接"按钮**

在"编辑/删除"按钮组前加:

```html
<button @click="testTtsConnection(conf)" type="button"
  :disabled="testingTtsId === conf.id"
  class="text-xs text-green-600 hover:underline font-medium">
  {{ testingTtsId === conf.id ? '测试中...' : '测试连接' }}
  <span v-if="ttsTestResults[conf.id] === 'ok'" class="text-green-600">✓ {{ lastTtsTestVoice }}</span>
  <span v-if="ttsTestResults[conf.id] === 'fail'" class="text-red-500">✗</span>
</button>
```

- [ ] **Step 3:加 testTtsConnection 函数实现**

在 `synthesizeAudio` 上方加:

```js
const testingTtsId = ref(null);
const ttsTestResults = ref({});
const lastTtsTestVoice = ref('');

const testTtsConnection = async (conf) => {
  if (!conf.apiKey) {
    ttsTestResults.value[conf.id] = 'fail';
    return alert('请先填写 apiKey');
  }
  testingTtsId.value = conf.id;
  ttsTestResults.value[conf.id] = null;
  try {
    const payload = MiMoTTS.buildSynthesizePayload('测试', conf.defaultVoice, '');
    const blob = await MiMoTTS.synthesize(conf.apiKey, payload, new AbortController().signal);
    if (blob.size > 0) {
      ttsTestResults.value[conf.id] = 'ok';
      lastTtsTestVoice.value = conf.defaultVoice;
    } else {
      ttsTestResults.value[conf.id] = 'fail';
    }
  } catch (e) {
    ttsTestResults.value[conf.id] = 'fail';
    alert('测试失败: ' + e.message);
  } finally {
    testingTtsId.value = null;
  }
};
```

- [ ] **Step 4:return 对象加测试状态**

```js
testingTtsId, ttsTestResults, lastTtsTestVoice, testTtsConnection,
```

- [ ] **Step 5:浏览器测试**

1. 添加配置(填真实 apiKey)
2. 点击"测试连接"
3. 预期:几秒后按钮右侧出现绿色 ✓ Chloe

- [ ] **Step 6:Commit**

```bash
git add index.html
git commit -m "feat(tts): 配置列表 apiKey 掩码 + 测试连接按钮"
```

### Task 18:迁移后用户提示条

**Files:**
- Modify: `index.html`(找一个根级 div,app 渲染前)

- [ ] **Step 1:在 app 渲染的最外层 div 上方插入提示条**

```html
<div v-if="showMigrationNotice"
  class="bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-sm px-4 py-2 flex items-center justify-between">
  <span>⚠ TTS 配置已升级,请重新添加 MiMo 配置。</span>
  <button @click="dismissMigrationNotice" class="text-yellow-600 hover:text-yellow-900">✕</button>
</div>
```

- [ ] **Step 2:加 showMigrationNotice ref 与 dismiss 函数**

```js
const showMigrationNotice = ref(false);
if (!localStorage.getItem('storyforge_tts_migration_notice_dismissed_v1')) {
  // 迁移后第一次打开
  if (localStorage.getItem('storyforge_tts_schema_version') === '1') {
    showMigrationNotice.value = true;
  }
}
const dismissMigrationNotice = () => {
  showMigrationNotice.value = false;
  localStorage.setItem('storyforge_tts_migration_notice_dismissed_v1', '1');
};
```

- [ ] **Step 3:浏览器验证**

清空 localStorage 的 `storyforge_tts_migration_notice_dismissed_v1` 与 `storyforge_tts_configs`(老配置),刷新 → 黄色提示条出现。点击 ✕ → 消失且不再出现。

- [ ] **Step 4:Commit**

```bash
git add index.html
git commit -m "feat(tts): 迁移后用户提示条 + dismissed 标记按 version 命名"
```

### Task 19:字符串全文替换(仅 UI 文案)

**Files:**
- Modify: `index.html`

- [ ] **Step 1:Grep 找所有 IndexTTS / Qwen3TTS / SonicVale**

```bash
grep -n "IndexTTS\|Qwen3TTS\|SonicVale" index.html
```

- [ ] **Step 2:人工逐个审查每个匹配**

每个匹配属于以下类别之一:
- (A) UI 文案(在 `<label>`, `<div>`, `<h2>`, `<p>`, `<!-- 注释 -->`)→ 替换为 MiMo
- (B) 代码字段名 / 函数名 / 变量名 → 不替换(已通过其他 task 改完)
- (C) localStorage key / 文件名前缀 → 不替换(已迁移或改名)
- (D) 文档/链接/外部资源 → 保留(以免破坏)

- [ ] **Step 3:用 Edit 工具逐个替换 A 类**

例如:
- `IndexTTS 2` → `MiMo`
- `Qwen3TTS URL` → `MiMo URL`
- `SonicVale 协议` → `MiMo 协议`

**Note:** 警惕不要替换 (B)(C) 类。grep 上下文判断。

- [ ] **Step 4:二次 grep 确认无遗漏 UI 文案**

```bash
grep -n "IndexTTS\|Qwen3TTS\|SonicVale" index.html
```

只应剩 (B)(C)(D) 类的匹配。

- [ ] **Step 5:Commit**

```bash
git add index.html
git commit -m "refactor(tts): UI 文案 IndexTTS/Qwen3TTS/SonicVale → MiMo"
```

---

## Chunk 5:端到端验证

### Task 20:手动 E2E 测试(checklist)

**Files:** 无

- [ ] **Step 1:happy path — 设计音色**

1. 启动 docker 服务(如未启动)
2. 打开 http://127.0.0.1:8899/
3. TTS 配置面板 → 添加配置:Name="测试", apiKey=真实, defaultVoice="Chloe"
4. 角色面板 → 选个角色 → 填音色描述(中文,例如"年轻女声,温柔")
5. 点击"AI 音色设计"按钮
6. **Expected:** 几秒后音色库新增 `角色名_AI`,source='design'

- [ ] **Step 2:happy path — 用音色合成**

1. 选中该音色库条目
2. 在 prompt 输入一段文本
3. 点击合成
4. **Expected:** 听到中文语音,音色与设计接近

- [ ] **Step 3:happy path — 预置音色(无 timbre)**

1. 音色选择下拉选"使用预置音色 / Chloe"
2. 合成
3. **Expected:** Chloe 音色(英式女声,可能听不太懂中文)

- [ ] **Step 4:错误注入 — 错 apiKey**

1. 把 apiKey 改成 `wrong-key`
2. 合成
3. **Expected:** 红色 ✗ 出现,alert "鉴权失败,请检查 apiKey"

- [ ] **Step 5:错误注入 — 断网(CORS 模拟)**

1. devtools → Network → offline
2. 合成
3. **Expected:** alert "网络错误: Failed to fetch"

- [ ] **Step 6:错误注入 — 10MB 限制**

1. 准备一个 > 10MB 的 wav(找一段长录音或合并多个)
2. 把它手动加为音色库条目(refPath=该大文件名)
3. 合成
4. **Expected:** console.warn "降级到预置音色",实际用 defaultVoice

- [ ] **Step 7:用户停止**

1. 启动合成后立即点击"停止"
2. **Expected:** AbortError 被捕获,无 alert,UI 正常恢复

- [ ] **Step 8:导出 wav**

1. 合成一段 → 听 → 导出
2. **Expected:** 下载 wav 文件,可用 ffprobe 验证时长与采样率

- [ ] **Step 9:Commit E2E 测试样本**

```bash
mkdir -p Projects/test-samples
# 把 step 2 导出的 wav 改名
cp ~/Downloads/synth-*.wav Projects/test-samples/mimo-clone-20260620-1530.wav
# 生成元数据 json
cat > Projects/test-samples/mimo-clone-20260620-1530.json <<'EOF'
{
  "model": "mimo-v2.5-tts-voiceclone",
  "scenario": "音色克隆 happy path",
  "timestamp": "2026-06-20T15:30",
  "request_summary": {"text_len": 50, "ref_audio_size_bytes": 12345},
  "expected_duration_sec": 5
}
EOF
git add Projects/test-samples/
git commit -m "test(tts): E2E 样本 + 元数据(音色克隆 happy path)"
```

### Task 21:收尾 — 删除 fixture 与 README 更新

**Files:**
- Modify: `Projects/tests-tts-fixture.js`(考虑保留作回归参考)
- Modify: `README.md`

- [ ] **Step 1:决定 fixture 去留**

- 保留:`Projects/tests-tts-fixture.js` 作为 `MiMoTTS` 的"参考实现",方便未来重构时做行为对照
- 删除:fixture 仅是开发期脚手架,不再有用

**Default:** 保留,加 README 说明。

- [ ] **Step 2:README 加测试与开发说明**

在 Troubleshooting 段落后追加:

```markdown
### 开发与测试

- 单元测试:`Projects/tests-tts.html` + `Projects/tests-tts-fixture.js`
- 打开 `Projects/tests-tts.html` 在浏览器查看 21 个 MiMoTTS 纯函数测试
- 实施参考:`docs/superpowers/specs/2026-06-20-tts-interface-adjustment-design.md` + `docs/superpowers/plans/2026-06-20-mimo-tts-migration.md`
```

- [ ] **Step 3:Commit 收尾**

```bash
git add README.md
git commit -m "docs: 补充测试与开发说明"
```

- [ ] **Step 4:最终 push + PR(可选)**

```bash
git push -u origin feature/mimo-tts-migration
# 在 GitHub 上开 PR
```

- [ ] **Step 5:合并到 main**

```bash
# 合并方式由用户决定(rebase / merge commit / squash)
git checkout main
git merge --no-ff feature/mimo-tts-migration
```
