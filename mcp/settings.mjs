import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

function defaults() {
  return {
    schemaVersion: 2,
    researchFrontier: false,
    firstUseNoticeShown: false,
    resources: { topics: [], files: [], books: [] },
  };
}

export const FRONTIER_NAME = "前沿研究模式（Research Frontier）";

export const FRONTIER_NOTICE =
  "提示：当前使用标准研究配置。本插件还提供“前沿研究模式（Research Frontier）”，可通过 metaso_research_frontier 设置为 enable 全局启用；启用后会增加检索轮次、来源数量、全文读取和交叉验证，并优先使用思考模型。";

function defaultStateDirectory() {
  if (process.env.METASO_STATE_DIR) return resolve(process.env.METASO_STATE_DIR);
  const codexHome = process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME)
    : join(homedir(), ".codex");
  return join(codexHome, "state", "metaso-search-neo");
}

function normalize(value) {
  const fallback = defaults();
  return {
    schemaVersion: 2,
    researchFrontier: Boolean(value?.researchFrontier),
    firstUseNoticeShown: Boolean(value?.firstUseNoticeShown),
    resources: {
      topics: Array.isArray(value?.resources?.topics) ? value.resources.topics : fallback.resources.topics,
      files: Array.isArray(value?.resources?.files) ? value.resources.files : fallback.resources.files,
      books: Array.isArray(value?.resources?.books) ? value.resources.books : fallback.resources.books,
    },
    ...(typeof value?.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
  };
}

export class PluginSettings {
  constructor(options = {}) {
    this.path = options.path ?? join(defaultStateDirectory(), "settings.json");
    this._queue = Promise.resolve();
    this._recoveryQueue = Promise.resolve();
    this._fallbackNoticeShown = false;
    this.warning = null;
  }

  async recoverMalformedState() {
    const operation = this._recoveryQueue.then(async () => {
      try {
        return normalize(JSON.parse(await readFile(this.path, "utf8")));
      } catch (error) {
        if (error?.code === "ENOENT") return defaults();
        if (!(error instanceof SyntaxError)) throw error;
        const backupPath = `${this.path}.corrupt-${Date.now()}`;
        try {
          await rename(this.path, backupPath);
          this.warning = `Malformed plugin state was preserved at ${backupPath}; defaults were restored.`;
        } catch (renameError) {
          if (renameError?.code !== "ENOENT") throw renameError;
          this.warning = "Malformed plugin state was recovered by a concurrent plugin request; defaults were restored.";
        }
        return defaults();
      }
    });
    this._recoveryQueue = operation.catch(() => {});
    return operation;
  }

  async read() {
    try {
      return normalize(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return defaults();
      if (error instanceof SyntaxError) return this.recoverMalformedState();
      throw error;
    }
  }

  async write(settings) {
    const next = {
      ...normalize(settings),
      updatedAt: new Date().toISOString(),
    };
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
    return next;
  }

  async update(mutator) {
    const operation = this._queue.then(async () => {
      const current = await this.read();
      return this.write(await mutator({ ...current }));
    });
    this._queue = operation.catch(() => {});
    return operation;
  }

  async setFrontier(enabled) {
    return this.update((current) => ({
      ...current,
      researchFrontier: Boolean(enabled),
      firstUseNoticeShown: enabled ? true : current.firstUseNoticeShown,
    }));
  }

  async recordTopic(topic) {
    if (!topic?.id) return this.read();
    return this.update((current) => {
      const record = {
        id: String(topic.id),
        name: topic.name ?? null,
        dirRootId: topic.dirRootId ?? topic.dir_root_id ?? null,
        description: topic.description ?? null,
        createdAt: new Date().toISOString(),
      };
      current.resources.topics = [
        ...current.resources.topics.filter((item) => String(item.id) !== record.id),
        record,
      ];
      return current;
    });
  }

  async recordFiles(files, context = {}) {
    const valid = (files ?? []).filter((file) => file?.id ?? file?.fileId);
    if (!valid.length) return this.read();
    return this.update((current) => {
      const topic = current.resources.topics.find(
        (item) => item.dirRootId && String(item.dirRootId) === String(context.dirRootId),
      );
      for (const file of valid) {
        const fileId = String(file.id ?? file.fileId);
        const record = {
          fileId,
          fileName: file.fileName ?? file.file_name ?? context.fileName ?? null,
          dirRootId: context.dirRootId ? String(context.dirRootId) : file.parentId ?? null,
          topicId: topic?.id ?? null,
          kind: "topic-file",
          createdAt: new Date().toISOString(),
        };
        current.resources.files = [
          ...current.resources.files.filter((item) => String(item.fileId) !== fileId),
          record,
        ];
      }
      return current;
    });
  }

  async recordBook(book) {
    const fileId = book?.fileId ?? book?.file_id;
    if (!fileId) return this.read();
    return this.update((current) => {
      const record = {
        bookId: book.id ? String(book.id) : null,
        fileId: String(fileId),
        title: book.title ?? null,
        url: book.url ?? null,
        kind: "bookshelf",
        createdAt: new Date().toISOString(),
      };
      current.resources.books = [
        ...current.resources.books.filter((item) => String(item.fileId) !== record.fileId),
        record,
      ];
      return current;
    });
  }

  async removeFiles(ids) {
    const targets = new Set((ids ?? []).map(String));
    return this.update((current) => {
      current.resources.files = current.resources.files.filter(
        (item) => !targets.has(String(item.fileId)),
      );
      current.resources.books = current.resources.books.filter(
        (item) => !targets.has(String(item.fileId)),
      );
      return current;
    });
  }

  async removeTopics(ids) {
    const targets = new Set((ids ?? []).map(String));
    return this.update((current) => {
      const removedDirRoots = new Set(
        current.resources.topics
          .filter((item) => targets.has(String(item.id)))
          .map((item) => String(item.dirRootId ?? ""))
          .filter(Boolean),
      );
      current.resources.topics = current.resources.topics.filter(
        (item) => !targets.has(String(item.id)),
      );
      current.resources.files = current.resources.files.filter(
        (item) =>
          (!item.topicId || !targets.has(String(item.topicId))) &&
          (!item.dirRootId || !removedDirRoots.has(String(item.dirRootId))),
      );
      return current;
    });
  }

  async resourceCatalog(kind = "all") {
    const current = await this.read();
    if (kind === "topics") return { topics: current.resources.topics };
    if (kind === "files") return { files: current.resources.files };
    if (kind === "books") return { books: current.resources.books };
    return current.resources;
  }

  async consumeFirstUseNotice() {
    try {
      let show = false;
      const settings = await this.update((current) => {
        if (!current.researchFrontier && !current.firstUseNoticeShown) {
          show = true;
          current.firstUseNoticeShown = true;
        }
        return current;
      });
      return { show, settings, notice: show ? FRONTIER_NOTICE : null };
    } catch {
      const show = !this._fallbackNoticeShown;
      this._fallbackNoticeShown = true;
      return { show, settings: defaults(), notice: show ? FRONTIER_NOTICE : null };
    }
  }
}
