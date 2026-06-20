# Unitale AI有声书制作工具
[![](https://img.shields.io/badge/Author-sdsds222-orange.svg)](https://gitee.com/wangjiabin-x/uh5)
[![license](https://img.shields.io/github/license/elemefe/vue-amap.svg?style=flat-square)](https://github.com/sdsds222)
![GitHub](https://img.shields.io/badge/dynamic/json?logo=github&label=GitHub+Followers&labelColor=282c34&color=181717&query=%24.data.totalSubs&url=https%3A%2F%2Fapi.spencerwoo.com%2Fsubstats%2F%3Fsource%3Dgithub%26queryKey%3Dsdsds222&longCache=true)
[![Bilibili](https://img.shields.io/badge/dynamic/json?logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAD7ElEQVR4nO2dW9WrMBCFK6ESkFAJSKiESqgEHCABCZWAhEpAAhL2ecik5dDc%2FpXLBDLfWnlqy0xmJ5BMQnq5CIIgCIIgCIIgCIIgCEIBAHQAemYfrgCunD6wAKAHsEKxALgx+bCQD8%2FS9tmgVqeDr1lLigDgZvDhXso+K9TyTBQRwRJ8AHjntl0Flh5QRAQK%2FmKxPeayWx2OXpBNBKiHvi34b7T2MC4pAvW6twR%2FRwkRKPizBN8CgEcuESj4Lwm+BwBjahEk+H8EwJRKhOaCDzW8e1JLfkUUH1NgmR3XmHffHR1l+72BSs8d7w8U+JDAnZERQMcV+CtUi7dNqFqibB4J7vtrq7xKCuAasbTMXCL4T+5aVk6+2xHUrWdhruAR6HIJcOeu2UHI8zyAe2ytWfEdWz9PVvQ8YAmIQ5dDAB9LFsMVAv8oMO2zAGrC5WNIarRiAuKR9jYEd9pY08aa6uUzIHGRdkgKd8pY0yc1WjEBAqypDYoAG0QAZkQAZkQAZkQAZk4vANQenjsSzS3I%2FwcSbXU5jQBUkRtdf4Rar90v8kSv3+I3ffCCSpk8I%2Fw+lgDkdI%2Fv2rEp2CaiWm1AsDQLlDAD+dlFXLMeAaCSeLZdaSFE5VUQNot38cKuEeBgAsSuG0flVZBmEanbXfNQAsS0fgBYIn2fIu3%2FBBMHEyBmDXlFfA8IzeHb+Ems4WAChKykrVA9ZfsQTL57jXzRg4A5wC%2FA8N4ADiZAZwm2XjW75Qh2KOTfA0p4kygPw28OJcCVgn3nDnYo2EwEYRgGH0qAMyICMCMCMCMCMCMCMCMCMCMCfP3qwHDOQ4AAUekTk8FaBRihJnZdYbvtCGC7LvmkM63GjVDINPFrQgCq5ETXfmMzI90FXzPvfqt7x4rEu%2FZaEcCUxFvgz2zO+BUn6UkoaEEAsptiMSX5e8FoRYCN7cVgb4Vq7U%2FH50Pq4JNP7Qiw8UFnJwcK+tXy+Wj6PLEvPgHSHv5UgwA1IQIwwyFAyLJin9RoxYgAzAQIkPwNmf26busC+OIx5TDqo5nDT+F%2FSS%2F9CYzwb+No49zNy2evkYv0LywGGAXUvp6eSneycqOic0w20k7CNgKE7jJunSGLACTCxF27ylmQc98T5MQUH49swd+I0HPXslLKnT0N+wnkrTKi9JZL%2FL9i1SorMmdeQ4TQQ7OFMxIMzGD45w8nUL1im7efENZLJpgPSw0pfz0cdt4U3230Td%2FTvx2R6d2FrHhEWLkq5PELOMsRPHCPnAZGv1xJteL7jbJiaW3sB2nDvPC%2FosSYvjRQz4cJ6n7KO3rYQL7M+L6nVtfDVRAEQRAEQRAEQRAEIZ5%2FSAXmdfXaoQsAAAAASUVORK5CYII%3D&label=bilibili+fans&labelColor=FE7398&color=282c34&query=%24.data.totalSubs&url=https%3A%2F%2Fapi.spencerwoo.com%2Fsubstats%2F%3Fsource%3Dbilibili%26queryKey%3D11354448&longCache=true)](https://space.bilibili.com/11354448)


一个基于Indextts和Qwen3TTS的 AI Agent 有声书制作工具。利用 LLM 自动拆解剧本与识别情绪，集成多角色 TTS 语音合成（可智能分析音色并使用Qwen3TTS语音设计模型从音色描述文本生成音色），支持音效(SFX)、背景音乐(BGM)混音及实时台词音频滤波器的自动插入和匹配，可直接在浏览器导出 wav 成品，本工具本体无需配置环境即可跨平台在浏览器使用。

现已支持背景图片提示词生成功能，可一键导出带情节背景图片和故事音频的mp4视频。

先看使用教程：https://www.bilibili.com/video/BV1KSzWByEy7

语音智能合成效果演示：https://www.bilibili.com/video/BV1Nvc7zjEd1

界面简洁，使用简单，能够一键生成，用户可以对生成的音频内容进行微调。

![主界面截图](界面图2.png)

### 工具在线使用页面（须自行配置LLM和云原生TTS项目的URL）：

https://sdsds222.github.io/Unitale/

1.5版本更新：现已支持LLM分析产生背景图片提示词，能够实现不同图片中出现的人物特征一致。需要用户自行将图片生成提示词复制粘贴到其他的图片生成模型后，手动存入背景图片块中，即可导出符合故事情节背景图片和故事音频的mp4格式视频。


现已支持音色自动分析生成功能，基于llm分析剧情，产生角色音色描述文本，再利用描述文本使用qwen3tts生成音色参考音频。

初始资源包（含音色、音效、BGM等素材）：

【请解压后再导入工程！】下载地址：https://wwazp.lanzouw.com/i9S4t3ihazba

或者直接下载本仓库的初始工程文件，如果网速允许的话。

### IndexTTS 2 免费云原生项目：
最新：https://cnb.cool/ConyStudio/IndexTTS2-Qwen3VoiceDesign

~~旧版：https://cnb.cool/ConyStudio/index-tts-v2~~

Fork云原生仓库后，即可点击按钮在线启动部署，启动后，在前端TTS配置界面输入云原生项目的port里面的Ip地址即可调用。

如果需要本地部署，需要使用旧版的CNB项目，现在本地搭建一个基于官方的IndexTTS2模型，然后将旧版的cnb项目中的api.py脚本放入webui.py同目录下，使用uv启动api.py，即可使用本工具调用（但无法使用Qwen3TTS音色设计功能）。

使用资源调度管理脚本，实现在同一个云原生工程内共存两个模型。

b站生成效果演示视频：

https://www.bilibili.com/video/BV1qjF1zuEc5/

https://www.bilibili.com/video/BV1GpF1zNEXm/

https://www.bilibili.com/video/BV1AkzLB7E8M

https://www.bilibili.com/video/BV1v2kjB5EKV

https://www.bilibili.com/video/BV1jYkGBqEkL





### LLM使用OpenAI通用接口
LLM支持使用各种支持OpenAI通用接口的大模型。

本人测试使用的是Gemini的Openai通用接口。输入Base URL：https://generativelanguage.googleapis.com/v1beta/openai   以及你的APIKEY即可设置完成。


### 音频资源整合包
下载地址（请解压后再导入工程）：https://wwazp.lanzouw.com/i9S4t3ihazba

可以在编辑界面点击保存工程按钮，能够保存音色、音效、BGM、滤波器和脚本编辑工作台的所有信息，一定要记得经常保存，页面清空后可以用存档文件恢复所有工作状态。

新手可以先使用制作好的初始工程整合包，里面提供了基础的音色、音效、BGM供使用，在本项目目录里，Unitale工程文件.json

![主界面截图](界面图1.png)

## 核心功能:

一个自制的 AI 有声故事生成工作台。利用 LLM 深度理解小说文本，实现了音效自动插入、BGM 自动切换、场景滤波器自动设置以及多角色情绪自动演绎的完整自动化编排，在浏览器中一键生成有声音频作品。

AI音色自动合成：能够分析文本，为角色智能生成音色描述文本，使用Qwen3TTS音色设计模型生成对应的参考音频。

AI 自动音效编排：系统能够深度理解文本中的动作描写与环境氛围，自动从本地素材库中检索匹配的音效，并精确计算其在台词念白过程中的插入时间点，无需人工手动对轨。

AI 动态配乐系统：AI 实时分析剧情的情绪起伏与转折，自动判断背景音乐的切入、停止与无缝切换时机，实现配乐与剧情发展的同步。

AI 场景感知滤波器：系统自动检测特殊的对话场景（如“电话通话中”、“内心独白”、“水下对话”、“广播通知”），并自动为对应台词挂载实时音频滤波器，还原真实的物理声场听感。

深度情绪与角色演绎：自动拆分小说段落，精准区分旁白与不同角色，并根据上下文推断角色的情绪强度，产生情绪描述提示词，指导 TTS 生成有感染力的语音表演。


![主界面截图](Snipaste_2026-01-20_05-40-53.png)


音频资源库默认为空，可以导入项目文件夹里面的json工程存档获取音频资源库，或者按照下面截图的配置进行手动填写：

SFX场景音效资源库:

![主界面截图](sfx1.png)

![主界面截图](sfx2.png)

![主界面截图](sfx3.png)

BGM背景音乐资源库：

![主界面截图](BGM.png)

## 本地化与导出:

支持导出/导入工程文件 (.json)，保存所有编辑状态。

高度可配置: 自定义 Prompt 模板、情绪预设、音色库和音效素材库。

### Troubleshooting: MiMo CORS 状态

- 2026-06-20:验证通过。`OPTIONS` 与 `POST` 均直连成功,`access-control-allow-origin: *`,允许 `api-key` 与 `content-type` 头。
- 实施人:Claude + sdsds222
- 验证命令:见 `docs/superpowers/plans/2026-06-20-mimo-tts-migration.md` Task 1

### 开发与测试

- 单元测试:`Projects/tests-tts.html` + `Projects/tests-tts-fixture.js`
- 浏览器打开 `Projects/tests-tts.html` 跑 19 个 MiMoTTS 纯函数测试
- node 端等效运行:`node Projects/run-tests-node.mjs`
- 实施参考:`docs/superpowers/specs/2026-06-20-tts-interface-adjustment-design.md` + `docs/superpowers/plans/2026-06-20-mimo-tts-migration.md`


