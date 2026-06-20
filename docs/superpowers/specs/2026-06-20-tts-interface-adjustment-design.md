# TTS 接口调整:迁移到 Xiaomi MiMo-V2.5-TTS

**日期**: 2026-06-20
**范围**: 仅修改 `index.html` 中的 TTS 模块(约 230-280、1651-1655、2454、2633、2737-2772、2895-2998、3129-3200、5957-6054 行)
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

**音色库**(`timbres[]`,语义不变 + 一个新字段):

```js
{
  id: string,
  name: string,           // 如"小明_AI"
  description: string,    // 中文音色描述
  refPath: string,        // 本地 wav 文件名,即"voice ID"
  source: 'design' | 'clone' | 'unknown',  // 新增
}
```

### 2. 客户端封装

在 Vue setup 内 `ttsConfigs` ref 之后新增单一对象:

```js
const MiMoTTS = {
  ENDPOINT: 'https://api.xiaomimimo.com/v1/chat/completions',

  // 纯函数 payload 构造器(可单测)
  buildSynthesizePayload(text, voice, styleDesc) { ... },
  buildVoiceDesignPayload(description, text, optimizeText) { ... },
  buildVoiceClonePayload(text, base64Audio, mime) { ... },

  // 请求函数
  async synthesize(apiKey, payload, signal) { ... },
  async designVoice(apiKey, payload, signal) { ... },
  async cloneVoice(apiKey, payload, signal) { ... },

  // 响应解析
  parseAudioResponse(json) -> Blob,
};
```

### 3. 数据流

**语音合成**(`synthesizeAudio` 重写):

```
1. 选 timbre(refPath)
2. 读 wav → ArrayBuffer → base64
3. 预检:文件 ≤ 10MB 且 IndexedDB 可读
4. 若 timbre 存在 → MiMoTTS.cloneVoice(apiKey, {
     model: 'mimo-v2.5-tts-voiceclone',
     text, voice: 'data:audio/wav;base64,XXX'
   })
   否则 → MiMoTTS.synthesize(apiKey, {
     model: 'mimo-v2.5-tts',
     text, voice: defaultVoice,
     user 消息: ttsEmoText(情绪描述)
   })
5. parseAudioResponse → Blob → URL.createObjectURL
```

**音色设计**(`generateQwenVoice` 改名为 `generateAIVoice`):

```
1. 校验 char.voiceDescription 非空
2. MiMoTTS.designVoice(apiKey, {
     model: 'mimo-v2.5-tts-voicedesign',
     voice_description: char.voiceDescription,
     text: 模板生成的样例文本
   })
3. parseAudioResponse → Blob → 保存为 wav 到 localFileMap
4. 推入 timbres[],source = 'design',选中音色
```

**情绪表达策略**:老 `emo_text`(枚举字符串)直接放到 MiMo `user` 消息作为自然语言风格指令。如 `emo_text = "愤怒"` → `user: "用愤怒的语气说"`。LLM 与 Prompt 模板不动。

### 4. 错误处理

| 失败 | 处理 |
|---|---|
| 401/403(apiKey 错) | `MiMoError('鉴权失败,请检查 apiKey')`,UI 红 toast |
| 429(限流) | `MiMoError('请求过于频繁,请稍后重试')` |
| 5xx | 自动重试 1 次(等 1s),仍失败抛错 |
| 网络/CORS | `MiMoError('网络错误: ' + err.message)` |
| refPath > 10MB | 合成前预检,提示"参考音频过大,请用 ≤10MB 的文件" |
| refPath 文件丢失 | 合成前预检 IndexedDB,提示"音色文件丢失,请重新设计" |
| 用户主动停止 | 沿用 `AbortController`,不报错 |

### 5. UI 改动

替换原 line 227-278 表单:

```
配置名称:        [输入框]              ← 保留
MiMo apiKey:     [密码框 👁切换]        ← 新增(默认遮挡)
默认预置音色:     [下拉: Chloe/Mia/茉莉/...]  ← 新增
```

- 列表项展示:`MiMo: ****abcd`(末尾 4 位 + 掩码)
- 新增"测试连接"按钮:用默认音色合成一句测试文本,成功绿勾
- 全局搜索替换"IndexTTS" / "Qwen3TTS" / "SonicVale" 字样为"MiMo"(避免误导)

### 6. 数据迁移

启动时:

```
localStorage.getItem('storyforge_tts_schema_version')
=== null  → 清空 ttsConfigs,写入 '1',音色库保留(source 缺失补 'unknown')
=== '1'   → 跳过迁移
```

音色库 `timbres[]` 中的老 wav 文件保留(仍在 IndexedDB),但需在新一轮合成中重新选择(因为不再有"已上传到服务器"这个状态)。

## 不在范围

- 音色库面板、角色面板、SFX/BGM 面板(它们只与 `timbres[]` 交互,不变)
- LLM 配置、Prompt 模板、Mix/BGM 混音、视频导出(其他模块)
- 引入测试框架(jest/vitest 会破坏"无环境配置"卖点)
- 离线/本地 MiMo 部署(只走云端)

## 测试策略

新增 `Projects/tests-tts.html`(纯浏览器,无依赖),用 `<script type="module">` 写 5-10 个 `assert` 用例:

- `buildSynthesizePayload` 输出字段完整、stream=false
- `buildVoiceClonePayload` 包含正确 `data:audio/wav;base64,` 前缀
- `parseAudioResponse` 提取 base64 → Blob,长度匹配
- 错误响应(401/500)抛 `MiMoError` 且 message 含中文提示

端到端测试:开发者手动跑通,记录样本到 `Projects/test-samples/`。

## 风险与回滚

- **CORS**:MiMo 端点可能不允许浏览器直连 → 若失败,需要 MiMo 团队加 CORS 头或自建反代。**前置验证**:实现完成后第一个动作就是 `curl -X OPTIONS` 探测。
- **鉴权泄露风险**:apiKey 存 localStorage,明文 → 与现状一致(老 baseUrl 也无鉴权)。改进留给后续 issue(可加密存储)。
- **回滚**:git revert 即可,音色库文件不变。
