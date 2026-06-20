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
  defaultVoice: string,   // 预置音色名(9 选 1)
  // 删除:baseUrl, qwenUrl
}
```

**音色库**(`timbres[]`,CRUD 行为不变,新增 1 个字段):

```js
{
  id: string,
  name: string,
  description: string,    // 中文音色描述
  refPath: string,        // 本地 wav 文件名,即"voice ID"
  source: 'design',       // 本期固定值;未来音色克隆 UI 启用时再扩枚举
}
```

`defaultVoice` 取值固定为 9 个预置音色(来自 MiMo 文档):`mimo_default` / `冰糖` / `茉莉` / `苏打` / `白桦` / `Mia` / `Chloe` / `Milo` / `Dean`。保存时若不在该集合 → 表单校验拦截。

### 2. 客户端封装

在 Vue setup 内 `ttsConfigs` ref 之后新增单一对象。**边界**:`MiMoTTS` 只做"构造 payload + 发请求 + 解析响应",不接触 IndexedDB/Blob URL/UI 状态/Vue ref——所有 I/O 与状态由调用方传入传出,方便单测隔离。

```js
const MiMoTTS = {
  ENDPOINT: 'https://api.xiaomimimo.com/v1/chat/completions',
  RETRYABLE_STATUS: new Set([502, 503, 504]),
  POST_RETRY_ENABLED: true,  // 见 §4 风险,可通过临时改 false 关闭

  // 纯函数 payload 构造器(可单测)
  buildSynthesizePayload(text, voice, styleDesc) {
    return { model: 'mimo-v2.5-tts', messages: [
      { role: 'user', content: styleDesc || '用自然的语气说' },
      { role: 'assistant', content: text }
    ], audio: { format: 'wav', voice }, stream: false };
  },

  buildVoiceDesignPayload(description, text, optimizeText = true) {
    return { model: 'mimo-v2.5-tts-voicedesign', messages: [
      { role: 'user', content: description },
      { role: 'assistant', content: text }
    ], audio: { format: 'wav', optimize_text_preview: optimizeText }, stream: false };
  },

  buildVoiceClonePayload(text, base64Audio, mime) {
    // mime 必须由调用方传入(根据 refPath 后缀推断)
    return { model: 'mimo-v2.5-tts-voiceclone', messages: [
      { role: 'user', content: '' },
      { role: 'assistant', content: text }
    ], audio: { format: 'wav', voice: `data:${mime};base64,${base64Audio}` }, stream: false };
  },

  // 共享重试 helper
  async withRetry(fn) { ... },  // 见 §4

  // 请求函数(全部走 withRetry)
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
2. 若 timbre 非空:
   a. 从 IndexedDB 读 wav → ArrayBuffer
   b. 预检:文件 ≤ 10MB
   c. 推断 mime:refPath 末尾 .mp3 → 'audio/mpeg',其他 → 'audio/wav'
   d. 失败/超限 → console.warn + 降级到步骤 3 的默认合成路径(不让用户操作失败)
3. ArrayBuffer → base64(在 synthesizeAudio 内做,不放到 payload builder)
4. 分支:
   - timbre 有效 → MiMoTTS.cloneVoice(apiKey,
       MiMoTTS.buildVoiceClonePayload(text, base64Wav, mime),
       signal)
   - timbre 无效/降级 → MiMoTTS.synthesize(apiKey,
       MiMoTTS.buildSynthesizePayload(text, cfg.defaultVoice, ttsEmoText.value),
       signal)
5. MiMoTTS.parseAudioResponse(json) → Blob → URL.createObjectURL → audioUrl
```

**触发条件澄清**:音色来源(音色库 vs 预置)由用户在角色面板/SFX 试听面板中的"音色下拉"决定——已有 UI,不改。下拉选 `timbres[]` 里的某条 → 走 cloneVoice;选"使用预置音色"或留空 → 走 synthesize + defaultVoice。

#### 3.2 音色设计(`generateQwenVoice` 改名为 `generateAIVoice`)

**改名 grep 范围**(均为 index.html 内,执行 rename 之前先跑一次 grep 确认):
- 函数定义:`const generateQwenVoice = async (char)`
- 函数调用:`@click="generateQwenVoice(char)"`(角色面板按钮)
- 相关状态:`useCustomQwenVoiceText` / `customQwenVoiceTextTemplate` / `defaultQwenVoiceTextTemplate` → 改名为 `useCustomAIVoiceText` / `customAIVoiceTextTemplate` / `defaultAIVoiceTextTemplate`
- localStorage key:`storyforge_use_custom_qwen_voice_text` / `storyforge_qwen_voice_text_template` → `..._ai_voice_text_...`
- 文件名生成:`qwen_${char.name}_${Date.now()}.wav` → `design_${char.name}_${Date.now()}.wav`
- Prompt 模板变量 `${charName}` 等不动
- `/v1/qwen/design` 端点消失,改为 MiMoTTS.designVoice

**新流程**:

```
1. 校验 char.voiceDescription 非空
2. const template = useCustomAIVoiceText ? custom : default
3. const text = template.replace(...).replace(...)
4. MiMoTTS.designVoice(apiKey,
     MiMoTTS.buildVoiceDesignPayload(char.voiceDescription, text, true),
     signal)
5. parseAudioResponse → Blob → 保存为 wav 文件到 localFileMap
6. 推入 timbres[],source = 'design',选中音色
```

**情绪表达策略**:老 `emo_text`(枚举字符串)直接作为 MiMo `user` 消息内容。LLM/Prompt 模板不动。

### 4. 错误处理

| 失败 | 处理 |
|---|---|
| 401/403(apiKey 错) | `MiMoError('鉴权失败,请检查 apiKey')`,UI 红 toast |
| 429(限流) | `MiMoError('请求过于频繁,请稍后重试')`,**不重试** |
| 502/503/504 | `withRetry` 自动重试 1 次(等 1s);受 `POST_RETRY_ENABLED` 总开关控制 |
| 500(及其他非 5xx/非 2xx) | 不重试,直接抛错 |
| 网络/CORS | `MiMoError('网络错误: ' + err.message)`,**不重试**(CORS 错误重试无意义) |
| refPath > 10MB | 预检时**降级**到默认合成 + console.warn,不让用户操作失败 |
| refPath 文件丢失/损坏 | 预检时**降级**到默认合成 + console.warn,不让用户操作失败 |
| 用户主动停止 | 沿用 `AbortController`,不报错 |

`withRetry` 实现位置:MiMoTTS 内部共享 helper,3 个请求函数(从 fetch 到 fetch 响应判断)都走它,避免 502/503/504 行为不一致。

**POST 重试财务风险**:MiMo 可能对失败请求仍计费。`POST_RETRY_ENABLED = true` 为默认(已知风险);若观察到重复扣费,临时改为 `false` 即可关闭重试。UI 配置面板底部加一行说明:"网络异常时可能自动重试 1 次,可能产生额外费用"。

### 5. UI 改动

**配置表单**(替换原 line 227-278):

| 原字段 | 新字段 | 备注 |
|---|---|---|
| 配置名称 | 配置名称 | 保留 |
| IndexTTS Base URL | **(删除整行)** | |
| Qwen3TTS URL | **(删除整行)** | |
| — | MiMo apiKey | 新增,密码框,默认遮挡,👁 切换 |
| — | 默认预置音色 | 新增,下拉,**固定 9 个选项**(见 §1) |

**配置列表项**展示:`MiMo: ****abcd`(apiKey 末 4 位 + 掩码)。

**新增"测试连接"按钮**:
- 动作:发一次 `mimo-v2.5-tts` 合成请求,文本为短句(比如"测试"),voice 用 defaultVoice。成功 = 鉴权 + 端点 + 音色名都通。
- 成功:绿色 ✓ + 按钮右侧显示音色名(如"Chloe OK")
- 失败:红色 ✗ + toast 显示错误信息;**不**清空已填写的 apiKey

**字符串替换**:**仅**替换用户可见 UI 文案(在 `<label>`, `<div>`, `<!-- 注释 -->` 等用户能看到的区域)中的 `IndexTTS` / `Qwen3TTS` / `SonicVale` → `MiMo`。**不**替换:
- 代码字段名(`baseUrl` / `qwenUrl` 等已被删除,无须替换)
- 文件名字符串(`qwen_xxx.wav` 改为 `design_xxx.wav` 见 §3.2,但这是**改名**不是替换,见 §7)
- localStorage key(已迁移到 `_ai_voice_text_`,见 §3.2)

### 6. 数据迁移

启动时:

```js
const SCHEMA_VERSION = '1';
const v = localStorage.getItem('storyforge_tts_schema_version');
if (v !== SCHEMA_VERSION) {
  try {
    const old = localStorage.getItem('storyforge_tts_configs');
    if (old) localStorage.setItem('storyforge_tts_configs_backup_v0', old);
    localStorage.removeItem('storyforge_tts_configs');
    localStorage.setItem('storyforge_tts_schema_version', SCHEMA_VERSION);
  } catch (e) {
    console.warn('TTS config migration failed:', e);
  }
}
```

**用户感知**:
- 首次打开迁移后,页面顶部显示一次性黄色提示条:"TTS 配置已升级,请重新添加 MiMo 配置"。点击 ✕ 后标记 `storyforge_tts_migration_notice_dismissed_v1` 不再显示。**dismissed 标记按 schema version 命名**,未来 v2 升级时不会丢失提示。

**音色库 `source` 补全**:在 `synthesizeAudio` 读 timbre 时**按需补**(写回 IndexedDB),不在启动迁移里。代码位置:读 timbre 后立刻 `if (!timbre.source) { timbre.source = 'design'; saveAssetToDB(timbre); }`。

### 7. 实施顺序(依赖关系)

1. **CORS 探测**(零成本,先做):用浏览器 devtools 跑 `fetch('https://api.xiaomimimo.com/v1/chat/completions', {method:'OPTIONS'})`,确认浏览器可直连。
   - 失败 → 暂停实施,联系 MiMo 加 CORS 或自建反代
   - **通过后**:在 README.md 加一段 "Troubleshooting: MiMo CORS 状态(2026-06-20 验证通过)" 留档,后续开发者接手时可直接参考
2. **MiMoTTS 对象** + 4 个纯函数 + `withRetry` helper
3. **Projects/tests-tts.html** 测试上述纯函数
4. **synthesizeAudio** 重写(包含音色 source 按需补全)
5. **`generateQwenVoice` → `generateAIVoice` 改名 + 改实现 + 改调用点** + 关联 state/localStorage/文件名前缀
6. **UI 表单**替换 + "测试连接"按钮
7. **数据迁移逻辑**
8. **字符串全文替换** UI 文案(排除代码字段/文件名/localStorage key)
9. 手动端到端:
   - happy path:配 apiKey → 设计音色 → 用该音色合成 → 导出 wav
   - 音色克隆路径(用音色库 timbre 合成)
   - 预置音色路径(用 defaultVoice 合成,无 timbre)
   - 错误注入(故意填错 apiKey 验 401,断网验 CORS,改 defaultVoice 为不存在值验降级)
   - 验证 10MB 限制(用大文件走音色库时降级)

## 不在范围

- 音色库面板、角色面板、SFX/BGM 面板(只与 `timbres[]` 交互,不变)。**澄清**:音色库 CRUD 行为(新增/删除/试听/重命名)不变,仅 timbre 多 `source` 字段。
- LLM 配置、Prompt 模板、混音、视频导出(其他模块)
- 引入测试框架(jest/vitest 会破坏"无环境配置"卖点)
- 离线/本地 MiMo 部署
- 音色克隆 UI(本期 `source` 只取 `'design'`,不暴露 clone 入口)

## 测试策略

新增 `Projects/tests-tts.html`(纯浏览器,无依赖)。**mock 方式**:覆盖全局 `window.fetch` 返回 mock Response,测试结束恢复。

| 用例 | 覆盖 |
|---|---|
| `buildSynthesizePayload` 输出字段完整、stream=false、styleDesc fallback | happy + edge |
| `buildVoiceDesignPayload` 包含 `optimize_text_preview: true` 默认 | happy |
| `buildVoiceClonePayload` 包含正确 `data:audio/wav;base64,` 前缀 | happy |
| `parseAudioResponse` 从合法 JSON 提取 base64 → Blob,长度匹配 | happy |
| `parseAudioResponse` 响应缺 `audio.data` 时抛错 | error |
| `MiMoTTS.synthesize` 401 → `MiMoError` 含"鉴权失败" | error |
| `MiMoTTS.synthesize` 429 → `MiMoError` 含"限流",**不**触发重试(单次 fetch) | error |
| `MiMoTTS.synthesize` 502/503/504 → withRetry 触发 2 次 fetch | retry |
| `MiMoTTS.synthesize` 500 → 1 次 fetch,不重试 | error |
| `MiMoTTS.synthesize` AbortController 触发 → fetch 收到 abort signal,error.name === 'AbortError' | abort |
| `MiMoTTS.synthesize` 网络异常(TypeError) → `MiMoError` 含"网络错误",不重试 | error |
| `withRetry` 在 `POST_RETRY_ENABLED = false` 时即使 502 也不重试 | config |

**端到端测试样本格式**(约定):`Projects/test-samples/<model>-<scenario>-<YYYYMMDD-HHmm>.wav` + 同名 `.json` 元数据文件(含 `request` / `response_summary` / `expected_duration_sec`)。回归对比时读 wav 计算 RMS/长度。

## 风险与回滚

- **CORS**:见实施顺序 1,通过后写入 README 留档。
- **apiKey 明文存 localStorage**:与现状一致,改进留给后续 issue(可加密存储)。
- **POST 重试财务风险**:`POST_RETRY_ENABLED` 总开关可临时关闭;UI 配置面板底部有"可能产生额外费用"提示。
- **回滚**:`git revert` 即可;`storyforge_tts_configs_backup_v0` 留作应急恢复;音色库 wav 文件不变。
- **字符串全文替换误改**:仅替换 UI 文案(见 §5),文件名字符串是单独改名(见 §3.2/§7)。
