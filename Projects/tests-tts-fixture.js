// MiMoTTS fixture:与 index.html 内 MiMoTTS 对象保持一致
// 改 index.html 的 MiMoTTS 时,同步更新此处
export const MiMoTTS = {
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
