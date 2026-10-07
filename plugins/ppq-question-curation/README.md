# PPQ Practice Lab Question Curation

<img src="assets/ppq-logo.svg" width="64" height="64" alt="PPQ Practice Lab logo">

JASON Studio 的全流程题目归总插件：收集历年原卷与同变体评分标准，核验题干和评分关键词，统计真实出现频率，导出学习表或 PPQ 题库。

沿用 PPQ Practice Lab 的原版 Logo。插件包含一个可单独分享的 `exam-question-curation` Skill，没有常驻服务；普通资料整理不需要账号。MetaSo 可选；也可以使用本地已有试卷和其他可用检索工具。

## 安装

```sh
codex plugin marketplace add jasonhejiahuan/jasonstu-plugins
codex plugin add ppq-question-curation@jasonstu-plugins
```

已添加 Marketplace 时，先刷新列表：

```sh
codex plugin marketplace upgrade jasonstu-plugins
codex plugin add ppq-question-curation@jasonstu-plugins
```

重新打开 Codex 并开始新会话后使用：

> 用 $exam-question-curation 整理 2016–2025 年 CIE AS Physics 9702 Paper 2 的固定关键词题，覆盖 May/June 和 Oct/Nov 全部实际发布变体。保留 QP/MS 原页证据，按出现频率排序，并生成 PPQ 题库。

年份、考季、题型和输出由每次任务指定，上例不是固定范围。已有资料会优先复用，未核验内容会保留在待审队列。

## 工作流与数据保留

1. 明确范围，建立预期试卷清单，检索并验证真实 PDF，保留空缺和失败记录。
2. 按源文件哈希缓存带页码的文本，生成候选队列。
3. 核验同 variant 的 QP/MS 原页、子题号、原始分值、加粗/下划线及 Accept / Do not accept。
4. 保留每次出现的原题和评分依据，按真实已核验出现次数归总学习主题。
5. 导出有来源链接的 Markdown 学习表；需要时生成 `.ppqbank.jstu`，附件沿用原始试卷可读文件名，图片使用来源、用途及页码，用实际 PPQ 导入器验证。

PPQ 适配包含当前题库格式、IndexedDB、云同步 v2 和 D1 表/键的参考快照。每次任务仍须核对目标项目的最新代码。未知 root/nested metadata、`sourceDetails`、mark_scheme/modes 扩展、原始导入字节、附件和已发布修订均需保留；学习表不是完整数据库的替代品。

候选题、已核验题、已收齐文件和完成全部审阅分别计数。工具可以验证文件与证据记录，不能代替原页核验，不会修改用户进度。完整题库打包后会请求平台签名，由已有 PPQ 账号确认一次；签名不上传题库正文或将其自动加入公开目录。

## 分享与依赖

[Releases](https://github.com/jasonhejiahuan/jasonstu-plugins/releases) 提供插件 ZIP 和独立 Skill ZIP。独立版解压后，将整个 `exam-question-curation` 文件夹放入 `~/.codex/skills/`（或对应工具的 skills 目录）。无需复制这个私有 PPQ 项目，普通资料整理无需登录 PPQ；Canonical 签名需要有 Publish canonical question banks 权限的 PPQ 账号。

Skill 指令本身无运行依赖。PDF 工具需 Python 3.10+，并在可用的隔离环境安装：

```sh
python -m pip install -r skills/exam-question-curation/scripts/requirements.txt
```

具体输入格式、命令、退出码和断点续作说明见 [Skill](skills/exam-question-curation/SKILL.md)。包内只有工作流、代码、schema 快照与合成示例，不含考试 PDF、浏览器数据、凭据或用户练习数据。

## 验证与打包

```sh
python -m pip install -r skills/exam-question-curation/scripts/requirements.txt 'PyYAML>=6,<7'
python -m unittest discover -s skills/exam-question-curation/scripts -p 'test_*.py'
python scripts/validate_plugin.py
python scripts/package_plugin.py --out dist
```

测试使用临时合成 PDF，检查错误页、缺失 MS、过期证据、重复频次、未核验题隔离和 metadata 无损。仓库 CI 在 Linux、macOS 和 Windows 上运行。PPQ 项目实际导入/导出与云传输检查见 [验证记录](VALIDATION.md)。

本插件通过 GitHub Marketplace 分发；这不等同于上架 Codex 通用公开插件目录。代码和文档沿用仓库 MIT 许可；PPQ Logo 是 JASON Studio 的品牌标识。

## Canonical 题库签名

打包时写明原作者、已声明的模型（未知为 `null`）与打包者。签名记录实际批准发布的 PPQ 用户名，并保留第三方来源与未验证状态。需要 Python 3.10+ 和 Node.js 22+，不需要额外 npm 依赖或本地私钥：

```sh
python skills/exam-question-curation/scripts/normalize_asset_names.py questions.ppqbank.jstu --output questions-named.ppqbank.jstu
python skills/exam-question-curation/scripts/sign_question_bank.py questions-named.ppqbank.jstu
```

浏览器打开平台确认页；批准后生成独立的 `questions-named-signed.ppqbank.jstu`。原文件保持不变。详细契约见 [签名说明](skills/exam-question-curation/references/question-bank-signing.md)。

所有新打包附件必须遵循[可读命名规范](skills/exam-question-curation/references/asset-naming.md)：优先保留 `9702_s25_qp_21.pdf` 等官方原名，图片按来源、用途和页码命名，仅重名时追加短哈希。重命名同时更新 JSONL 路径与 ZIP 文件名，保留原字节、ID 和历史；必须在签名前完成。
