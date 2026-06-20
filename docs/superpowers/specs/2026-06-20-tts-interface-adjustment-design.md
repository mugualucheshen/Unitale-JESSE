# TTS 接口调整:迁移到 Xiaomi MiMo-V2.5-TTS

**日期**: 2026-06-20
**范围**: 仅修改 `index.html` 中的 TTS 模块
**目标**: 用单 MiMo API 替换"IndexTTS(语音合成) + Qwen3TTS(音色设计)"双服务

## 背景

当前架构依赖两个不同的 TTS 服务:

- **IndexTTS**(SonicVale 协议):`/v1/check/audio` → `/v1/upload_audio` → `/v2/synthesize`
- **Qwen3TTS**:`/v1/qwen/design`(根据音色描述生成参考音频)

二者必须协作,流程复杂(音色设计后还要把 wav 上传到 IndexTTS 服务器)。用户希望改用 Xiaomi MiMo-V2.5-TTS(单端点 `/v1/chat/completions`,三模型 `mimo-v2.5-tts` / `mimo-v2.5-tts-voicedesign` / `mimo-v2.5-tts-voiceclone`)以简化配置与流程。

## 设计

### 1. 数据模型

**TTS 配置**(`ttsConfigs[]`,每条记录):

```js
{
  id: string,
  name: string,           // 用户别名,如"小米 MiMo 个人版"
  apiKey: string,         // MIMO_API_KEY
  defaultVoice: string,   // 预置音色名(合成时无音色库的 fallback)
  // 删除:baseUrl, qwenUrl
}
```

**音色库**(`timbres[]`,CRUD 行为不变,新增 1 个字段):

```js
{
  id: string,
  name: string,           // 如"小明_AI"
  description: string,    // 中文音色描述
  refPath: string,        // 本地 wav 文件名,即"voice ID"
  source: 'design' | 'preset',  // 本期只实现 design;preset 留给"从预置音色直接生成的 wav"
  // 'clone' 留作未来音色克隆流程(本期 UI 不暴露)
}
```

### 2. 客户端封装

在 Vue setup 内 `ttsConfigs` ref 之后新增单一对象。**边界**:`MiMoTTS` 只做"构造 payload + 发请求 + 解析响应",不接触 IndexedDB/Blob URL/UI 状态/Vue ref——所有 I/O 与状态由调用方传入传出,方便单测隔离。

```js
const MiMoTTS = {
  ENDPOINT: 'https://api.xiaomimimo.com/v1/chat/completions',

  // 纯函数 payload 构造器(可单测)
  buildSynthesizePayload(text, voice, styleDesc) {
    // text: 待合成文本
    // voice: 预置音色名(如 'Chloe')
    // styleDesc: 情绪/风格描述(原 ttsEmoText),作为 user 消息内容
    return { model: 'mimo-v2.5-tts', messages: [
      { role: 'user', content: styleDesc || '用自然的语气说' },
      { role: 'assistant', content: text }
    ], audio: { format: 'wav', voice }, stream: false };
  },

  buildVoiceDesignPayload(description, text, optimizeText = true) {
    // description: 音色描述
    // text: 样例朗读文本
    // optimizeText: 是否对样例文本做润色(传给 MiMo 的 optimize_text_preview)
    return { model: 'mimo-v2.5-tts-voicedesign', messages: [
      { role: 'user', content: description },
      { role: 'assistant', content: text }
    ], audio: { format: 'wav', optimize_text_preview: optimizeText }, stream: false };
  },

  buildVoiceClonePayload(text, base64Audio, mime = 'audio/wav') {
    // text: 待合成文本
    // base64Audio: 已经 base64 编码的 wav(由调用方负责读取+编码,本函数只做拼接)
    return { model: 'mimo-v2.5-tts-voiceclone', messages: [
      { role: 'user', content: '' },
      { role: 'assistant', content: text }
    ], audio: { format: 'wav', voice: `data:${mime};base64,${base64Audio}` }, stream: false };
  },

  // 请求函数
  async synthesize(apiKey, payload, signal) { ... },
  async designVoice(apiKey, payload, signal) { ... },
  async cloneVoice(apiKey, payload, signal) { ... },

  // 响应解析:从 MiMo JSON 响应中取出 base64 并转 Blob
  parseAudioResponse(json) -> Blob,
};
```

### 3. 数据流

#### 3.1 语音合成(`synthesizeAudio` 重写)

**输入**:用户已选/绑定的 `timbre`(可能为 null)与 `ttsEmoText`(情绪描述)。

```
1. 读 cfg.apiKey(从 currentTtsConfig)
2. 预检:若 timbre 非空,refPath 文件 ≤ 10MB 且 IndexedDB 可读;否则报错
3. 读 wav → ArrayBuffer → base64(在 synthesizeAudio 内做,不放到 payload builder)
4. 分支:
   - timbre 非空 → MiMoTTS.cloneVoice(apiKey,
       MiMoTTS.buildVoiceClonePayload(text, base64Wav, 'audio/wav'),
       signal)
   - timbre 为空 → MiMoTTS.synthesize(apiKey,
       MiMoTTS.buildSynthesizePayload(text, cfg.defaultVoice, ttsEmoText.value),
       signal)
5. MiMoTTS.parseAudioResponse(json) → Blob → URL.createObjectURL → audioUrl
```

**触发条件澄清**:音色来源(音色库 vs 预置)由用户在角色面板/SFX 试听面板中的"音色下拉"决定——已有 UI,不改。下拉选 `timbres[]` 里的某条 → 走 cloneVoice;选"使用预置音色"或留空 → 走 synthesize + defaultVoice。

#### 3.2 音色设计(`generateQwenVoice` 改名为 `generateAIVoice`)

函数改名仅影响 index.html 内部。**调用方清单**(均在 index.html 内,grep 即可定位):
- 角色面板按钮 `@click="generateQwenVoice(char)"`(line 843 附近)
- 上述调用点同步改为 `generateAIVoice(char)`

**新流程**:

```
1. 校验 char.voiceDescription 非空
2. const template = useCustomQwenVoiceText ? customTemplate : defaultTemplate
3. const text = template.replace(...).replace(...)
4. MiMoTTS.designVoice(apiKey,
     MiMoTTS.buildVoiceDesignPayload(char.voiceDescription, text, true),
     signal)
5. parseAudioResponse → Blob → 保存为 wav 文件到 localFileMap(filename: 'design_xxx.wav')
6. 推入 timbres[],source = 'design',选中音色
```

**情绪表达策略**:老 `emo_text`(枚举字符串)直接作为 MiMo `user` 消息内容。LLM/Prompt 模板不动。

### 4. 错误处理

| 失败 | 处理 |
|---|---|
| 401/403(apiKey 错) | `MiMoError('鉴权失败,请检查 apiKey')`,UI 红 toast |
| 429(限流) | `MiMoError('请求过于频繁,请稍后重试')` |
| 5xx | **仅 502/503/504 自动重试 1 次(等 1s)**;500 不重试(可能服务端已扣费)。**POST 重试的财务风险提示**:若 MiMo 对失败请求仍计费,需在 UI 配置面板底部加一行 "重复请求可能产生额外费用"。 |
| 网络/CORS | `MiMoError('网络错误: ' + err.message)` |
| refPath > 10MB | 合成前预检,提示"参考音频过大,请用 ≤10MB 的文件" |
| refPath 文件丢失 | 合成前预检 IndexedDB,提示"音色文件丢失,请重新设计" |
| 用户主动停止 | 沿用 `AbortController`,不报错 |

`MiMoTTS` 内部统一拦截,各请求函数(上表)抛 `MiMoError` 实例。

### 5. UI 改动

**配置表单**(替换原 line 227-278):

| 原字段 | 新字段 | 备注 |
|---|---|---|
| 配置名称 | 配置名称 | 保留 |
| IndexTTS Base URL | **(删除)** | 整行移除 |
| Qwen3TTS URL | **(删除)** | 整行移除 |
| — | MiMo apiKey | 新增,密码框,默认遮挡,👁 切换 |
| — | 默认预置音色 | 新增,下拉,**固定 9 个选项**:mimo_default / 冰糖 / 茉莉 / 苏打 / 白桦 / Mia / Chloe / Milo / Dean(来自 MiMo 文档) |

**配置列表项**展示:`MiMo: ****abcd`(apiKey 末 4 位 + 掩码)。

**新增"测试连接"按钮**:
- 成功:绿色 ✓,并在按钮右侧显示"已连接 (Chloe 等)"
- 失败:红色 ✗ + toast 显示错误信息;**不**清空已填写的 apiKey(让用户修改后再测)

**字符串替换**:全文搜索 `IndexTTS` / `Qwen3TTS` / `SonicVale`,替换为 `MiMo`(用户可见文案),避免误导。

### 6. 数据迁移

启动时:

```
const SCHEMA_VERSION = '1';
const v = localStorage.getItem('storyforge_tts_schema_version');
if (v !== SCHEMA_VERSION) {
  try {
    // 1. 备份(应急回滚用)
    const old = localStorage.getItem('storyforge_tts_configs');
    if (old) localStorage.setItem('storyforge_tts_configs_backup_v0', old);
    // 2. 清空
    localStorage.removeItem('storyforge_tts_configs');
    // 3. 写版本号
    localStorage.setItem('storyforge_tts_schema_version', SCHEMA_VERSION);
  } catch (e) {
    console.warn('TTS config migration failed:', e);
    // 保留 raw 字符串供用户手动恢复
  }
}
```

**用户感知**:
- 首次打开迁移后,页面顶部显示一次性黄色提示条:"TTS 配置已升级,请重新添加 MiMo 配置"。点击 ✕ 后不再显示(localStorage 标记 `storyforge_tts_migration_notice_dismissed`)。
- 音色库 `timbres[]` 完全不动(老 wav 文件保留在 IndexedDB,`source` 字段缺失时补 `'design'`)。

### 7. 实施顺序(依赖关系)

1. **CORS 探测**(零成本,先做):用浏览器 devtools 跑 `fetch('https://api.xiaomimimo.com/v1/chat/completions', {method:'OPTIONS'})`,确认浏览器可直连。失败 → 暂停实施,联系 MiMo 加 CORS 或自建反代。
2. **MiMoTTS 对象** + 4 个纯函数(builder + parser)
3. **Projects/tests-tts.html** 测试上述纯函数
4. **synthesizeAudio** 重写
5. **generateQwenVoice → generateAIVoice** 改名 + 改实现 + 改调用点
6. **UI 表单**替换 + "测试连接"按钮
7. **数据迁移逻辑**
8. **字符串全文替换** IndexTTS/Qwen3TTS → MiMo
9. 手动端到端:配 apiKey → 设计音色 → 用该音色合成一段台词 → 导出 wav 验证

## 不在范围

- 音色库面板、角色面板、SFX/BGM 面板(它们只与 `timbres[]` 交互,不变)。**澄清**:音色库的 CRUD(新增/删除/试听/重命名)不变,只是新增的 timbre 多一个 `source` 字段。
- LLM 配置、Prompt 模板、混音、视频导出(其他模块)
- 引入测试框架(jest/vitest 会破坏"无环境配置"卖点)
- 离线/本地 MiMo 部署
- 音色克隆 UI(本期只在数据模型留 `'clone'` 枚举值,无入口)

## 测试策略

新增 `Projects/tests-tts.html`(纯浏览器,无依赖),用 `<script type="module">` 写用例:

| 用例 | 覆盖 |
|---|---|
| `buildSynthesizePayload` 输出字段完整、stream=false、messages 顺序 | happy path |
| `buildVoiceDesignPayload` 包含 `optimize_text_preview: true` 默认 | happy path |
| `buildVoiceClonePayload` 包含正确 `data:audio/wav;base64,` 前缀 | happy path |
| `buildSynthesizePayload` 在 styleDesc 为空时使用 fallback '用自然的语气说' | edge case |
| `parseAudioResponse` 从合法 JSON 提取 base64 → Blob,长度匹配 | happy path |
| `parseAudioResponse` 响应缺 `audio.data` 时抛错 | error path |
| `MiMoTTS` 在 401 响应下抛 `MiMoError`,message 含"鉴权失败" | error path |
| `MiMoTTS` 在 502/503/504 触发重试(用 mock fetch 验证 2 次调用) | error path |
| `MiMoTTS` 在 500 响应不重试,直接抛错 | error path |

端到端测试:开发者手动跑通,记录样本到 `Projects/test-samples/`。

## 风险与回滚

- **CORS**:MiMo 端点可能不允许浏览器直连 → 见"实施顺序 1"作为 Step 0 强制前置。
- **apiKey 明文存 localStorage**:与现状一致(老 baseUrl 也无鉴权),改进留给后续 issue(可加密存储)。
- **POST 重试财务风险**:见错误处理表注。
- **回滚**:git revert 即可;`storyforge_tts_configs_backup_v0` 留作应急恢复。音色库文件不变。
