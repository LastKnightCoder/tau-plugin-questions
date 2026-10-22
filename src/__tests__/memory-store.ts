/**
 * 测试用的内存数据层：按 SDK 文档的语义实现 entities / records / links / transaction，
 * 只覆盖问题插件用到的部分（筛选、排序、分页、revision、事务整体回滚）。
 */
import {
  PluginConflictError,
  type JsonValue,
  type PluginEntityRef,
  type PluginFieldCondition,
  type PluginIndexes,
  type PluginLink,
  type PluginLinkOptions,
  type PluginOrderBy,
  type PluginOwnEntity,
  type PluginOwnEntityInput,
  type PluginOwnEntityPatch,
  type PluginPage,
  type PluginRecord,
  type PluginRecordData,
  type PluginTransaction,
  type PluginWhere,
} from "@tau/plugins";
import type { QuestionStore } from "../data/questions";

type Row = { id: string; createdAt: number; updatedAt: number; fields: Record<string, JsonValue> };

const clone = <T>(value: T): T => structuredClone(value);

function matches(value: JsonValue | undefined, condition: PluginFieldCondition): boolean {
  const actual = value === undefined ? null : value;
  if (condition === null || typeof condition !== "object") return actual === condition;
  const ops = condition;
  if (ops.eq !== undefined && actual !== ops.eq) return false;
  if (ops.ne !== undefined && actual === ops.ne) return false;
  if (ops.in !== undefined && !ops.in.includes(actual as never)) return false;
  const comparable = typeof actual === "number" || typeof actual === "string";
  if (ops.gt !== undefined && !(comparable && actual > ops.gt)) return false;
  if (ops.gte !== undefined && !(comparable && actual >= ops.gte)) return false;
  if (ops.lt !== undefined && !(comparable && actual < ops.lt)) return false;
  if (ops.lte !== undefined && !(comparable && actual <= ops.lte)) return false;
  return true;
}

function checkWhere(where: PluginWhere | undefined, indexes: PluginIndexes) {
  for (const field of Object.keys(where ?? {}))
    if (!Object.hasOwn(indexes, field)) throw new Error(`字段 ${field} 未声明为索引`);
}

function query<T extends Row>(
  rows: T[],
  options: {
    where?: PluginWhere;
    orderBy?: PluginOrderBy | PluginOrderBy[];
    limit?: number;
    cursor?: string;
    builtin: Record<string, (row: T) => JsonValue>;
    indexes: PluginIndexes;
    defaultOrder: PluginOrderBy;
  }
): PluginPage<T> {
  checkWhere(options.where, options.indexes);
  const orders = options.orderBy
    ? Array.isArray(options.orderBy)
      ? options.orderBy
      : [options.orderBy]
    : [options.defaultOrder];
  const read = (row: T, field: string): JsonValue => {
    if (options.builtin[field]) return options.builtin[field](row);
    if (!Object.hasOwn(options.indexes, field)) throw new Error(`字段 ${field} 不能排序`);
    const value = row.fields[field];
    return typeof value === options.indexes[field] ? value : null;
  };
  const filtered = rows.filter(row =>
    Object.entries(options.where ?? {}).every(([field, condition]) =>
      matches(
        typeof row.fields[field] === options.indexes[field] ? row.fields[field] : null,
        condition
      )
    )
  );
  filtered.sort((a, b) => {
    for (const order of orders) {
      const desc = order.direction === "desc";
      const x = read(a, order.field);
      const y = read(b, order.field);
      if (x === y) continue;
      // 升序时没有值的排在最前，降序时排在最后
      if (x === null) return desc ? 1 : -1;
      if (y === null) return desc ? -1 : 1;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    }
    return a.id.localeCompare(b.id, "en", { numeric: true });
  });
  const offset = options.cursor ? Number(options.cursor) : 0;
  const limit = Math.min(options.limit ?? 50, 200);
  const items = filtered.slice(offset, offset + limit);
  return offset + limit < filtered.length ? { items, cursor: String(offset + limit) } : { items };
}

export function createMemoryStore(options: { now?: () => number } = {}) {
  let clock = 1_000;
  const now = options.now ?? (() => (clock += 1));
  let nextId = 1;
  const id = () => String(nextId++);

  type EntityRow = Row & { kind: string; key: string; title: string; revision: number };
  type RecordRow = Row & { collection: string; revision: number };
  type LinkRow = PluginLink & { sort: number };
  let state = {
    entities: new Map<string, EntityRow>(),
    records: new Map<string, RecordRow>(),
    links: new Map<string, LinkRow>(),
  };
  const kinds = new Map<string, PluginIndexes>();
  const collections = new Map<string, PluginIndexes>();

  const toEntity = (row: EntityRow): PluginOwnEntity => ({
    id: row.id,
    kind: row.kind,
    key: row.key,
    title: row.title,
    contentRef: `entity:${row.id}`,
    meta: clone(row.fields),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: String(row.revision),
  });
  const toRecord = (row: RecordRow): PluginRecord => ({
    id: row.id,
    collection: row.collection,
    data: clone(row.fields),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: String(row.revision),
  });
  const checkRevision = (row: { revision: number }, expected: string | undefined) => {
    if (expected !== undefined && expected !== String(row.revision)) throw new PluginConflictError();
  };
  const checkIndexed = (fields: Record<string, JsonValue>, indexes: PluginIndexes) => {
    for (const [field, type] of Object.entries(indexes)) {
      const value = fields[field];
      if (value !== undefined && value !== null && typeof value !== type)
        throw new Error(`字段 ${field} 的值必须是 ${type}`);
    }
  };

  /* ── 写入：直接调用与事务提交共用 ── */

  function createEntity(input: PluginOwnEntityInput, entityId = id()): EntityRow {
    const indexes = kinds.get(input.kind);
    if (!indexes) throw new Error(`类型 ${input.kind} 未声明`);
    for (const row of state.entities.values())
      if (row.kind === input.kind && row.key === input.key) throw new PluginConflictError();
    const meta = clone(input.meta ?? {});
    checkIndexed(meta, indexes);
    const time = now();
    const row: EntityRow = {
      id: entityId,
      kind: input.kind,
      key: input.key,
      title: input.title ?? "",
      fields: meta,
      createdAt: time,
      updatedAt: time,
      revision: 1,
    };
    state.entities.set(row.id, row);
    return row;
  }
  function updateEntity(entityId: string, patch: PluginOwnEntityPatch, expected?: string) {
    const row = state.entities.get(entityId);
    if (!row) throw new PluginConflictError("内容不存在");
    checkRevision(row, expected);
    if (patch.meta) {
      checkIndexed(patch.meta, kinds.get(row.kind) ?? {});
      row.fields = clone(patch.meta);
    }
    if (patch.title !== undefined) row.title = patch.title;
    row.updatedAt = now();
    row.revision += 1;
    return row;
  }
  function deleteEntity(entityId: string, expected?: string) {
    const row = state.entities.get(entityId);
    if (!row) throw new PluginConflictError("内容不存在");
    checkRevision(row, expected);
    state.entities.delete(entityId);
    for (const link of [...state.links.values()])
      if (link.from === entityId) state.links.delete(link.id);
  }
  function insertRecord(collection: string, data: PluginRecordData, recordId = id()): RecordRow {
    const indexes = collections.get(collection);
    if (!indexes) throw new Error(`集合 ${collection} 未声明`);
    checkIndexed(data, indexes);
    const time = now();
    const row: RecordRow = {
      id: recordId,
      collection,
      fields: clone(data),
      createdAt: time,
      updatedAt: time,
      revision: 1,
    };
    state.records.set(row.id, row);
    return row;
  }
  function updateRecord(collection: string, recordId: string, data: PluginRecordData, expected?: string) {
    const row = state.records.get(recordId);
    if (!row || row.collection !== collection) throw new PluginConflictError("记录不存在");
    checkRevision(row, expected);
    checkIndexed(data, collections.get(collection) ?? {});
    row.fields = clone(data);
    row.updatedAt = now();
    row.revision += 1;
    return row;
  }
  function deleteRecord(collection: string, recordId: string, expected?: string) {
    const row = state.records.get(recordId);
    if (!row || row.collection !== collection) throw new PluginConflictError("记录不存在");
    checkRevision(row, expected);
    state.records.delete(recordId);
  }
  const sameLink = (link: LinkRow, from: string, to: PluginEntityRef, role: string) =>
    link.from === from && link.to.kind === to.kind && link.to.id === to.id && link.role === role;
  function addLink(from: string, to: PluginEntityRef, options: PluginLinkOptions = {}): LinkRow {
    if (!state.entities.has(from)) throw new Error("来源不存在");
    const role = options.role ?? "";
    const siblings = [...state.links.values()].filter(link => link.from === from && link.role === role);
    const existing = siblings.find(link => sameLink(link, from, to, role));
    if (existing) return existing;
    const row: LinkRow = {
      id: id(),
      from,
      to: { ...to },
      role,
      data: clone(options.data ?? {}),
      createdAt: now(),
      sort: Math.max(0, ...siblings.map(link => link.sort)) + 1,
    };
    state.links.set(row.id, row);
    return row;
  }
  function reorderLinks(from: string, ids: readonly string[]) {
    const first = state.links.get(ids[0] ?? "");
    const role = first?.role;
    const siblings = [...state.links.values()].filter(link => link.from === from && link.role === role);
    if (!first || siblings.length !== ids.length || siblings.some(link => !ids.includes(link.id)))
      throw new Error("ids 须恰好是这一角色当前的全部关联");
    ids.forEach((linkId, index) => (state.links.get(linkId)!.sort = index + 1));
  }
  const toLink = ({ sort: _sort, ...link }: LinkRow): PluginLink => clone(link);

  const store: QuestionStore = {
    entities: {
      registerKind(definition) {
        kinds.set(definition.kind, definition.indexes ?? {});
        return { dispose: () => void kinds.delete(definition.kind) };
      },
      async create(input) {
        return toEntity(createEntity(input));
      },
      async get(entityId) {
        const row = state.entities.get(entityId);
        return row ? toEntity(row) : null;
      },
      async find(kind, key) {
        const row = [...state.entities.values()].find(r => r.kind === kind && r.key === key);
        return row ? toEntity(row) : null;
      },
      async query(options = {}) {
        if (options.where && !options.kind) throw new Error("按字段筛选需要给出 kind");
        const rows = [...state.entities.values()].filter(
          row =>
            (!options.kind || row.kind === options.kind) &&
            (!options.titleContains ||
              row.title.toLowerCase().includes(options.titleContains.toLowerCase()))
        );
        const page = query(rows, {
          ...options,
          builtin: { createdAt: r => r.createdAt, updatedAt: r => r.updatedAt, title: r => r.title },
          indexes: options.kind ? (kinds.get(options.kind) ?? {}) : {},
          defaultOrder: { field: "createdAt", direction: "desc" },
        });
        return { ...page, items: page.items.map(toEntity) };
      },
      async count(filter = {}) {
        return (await store.entities.query({ ...filter, limit: 200 })).items.length;
      },
      async update(entityId, patch, options) {
        return toEntity(updateEntity(entityId, patch, options.expectedRevision));
      },
      async delete(entityId, options) {
        deleteEntity(entityId, options.expectedRevision);
      },
      async backlinks() {
        return { items: [], omitted: 0 };
      },
    },
    records: {
      registerCollection(definition) {
        collections.set(definition.name, definition.indexes ?? {});
        return { dispose: () => void collections.delete(definition.name) };
      },
      async insert(collection, data) {
        return toRecord(insertRecord(collection, data));
      },
      async get(collection, recordId) {
        const row = state.records.get(recordId);
        return row && row.collection === collection ? toRecord(row) : null;
      },
      async query(collection, options = {}) {
        const indexes = collections.get(collection);
        if (!indexes) throw new Error(`集合 ${collection} 未声明`);
        const rows = [...state.records.values()].filter(row => row.collection === collection);
        const page = query(rows, {
          ...options,
          builtin: { createdAt: r => r.createdAt, updatedAt: r => r.updatedAt },
          indexes,
          defaultOrder: { field: "createdAt" },
        });
        return { ...page, items: page.items.map(toRecord) };
      },
      async count(collection, filter = {}) {
        return (await store.records.query(collection, { ...filter, limit: 200 })).items.length;
      },
      async update(collection, recordId, data, options) {
        return toRecord(updateRecord(collection, recordId, data, options.expectedRevision));
      },
      async delete(collection, recordId, options) {
        deleteRecord(collection, recordId, options.expectedRevision);
      },
    },
    links: {
      async add(from, to, options) {
        return toLink(addLink(from, to, options));
      },
      async list(from, options = {}) {
        return [...state.links.values()]
          .filter(link => link.from === from && (options.role === undefined || link.role === options.role))
          .sort((a, b) => (a.role === b.role ? a.sort - b.sort : a.role.localeCompare(b.role)))
          .map(toLink);
      },
      async remove(linkId) {
        state.links.delete(linkId);
      },
      async reorder(from, ids) {
        reorderLinks(from, ids);
      },
    },
    transaction: async run => {
      const ops: (() => void)[] = [];
      const tx: PluginTransaction = {
        entities: {
          async create(input) {
            const entityId = id();
            ops.push(() => void createEntity(input, entityId));
            return { id: entityId };
          },
          async update(entityId, patch, options) {
            ops.push(() => void updateEntity(entityId, patch, options?.expectedRevision));
          },
          async delete(entityId, options) {
            ops.push(() => deleteEntity(entityId, options?.expectedRevision));
          },
        },
        records: {
          async insert(collection, data) {
            const recordId = id();
            ops.push(() => void insertRecord(collection, data, recordId));
            return { id: recordId };
          },
          async update(collection, recordId, data, options) {
            ops.push(() => void updateRecord(collection, recordId, data, options?.expectedRevision));
          },
          async delete(collection, recordId, options) {
            ops.push(() => deleteRecord(collection, recordId, options?.expectedRevision));
          },
        },
        links: {
          async add(from, to, options) {
            ops.push(() => void addLink(from, to, options));
          },
          async remove(linkId) {
            ops.push(() => void state.links.delete(linkId));
          },
          async reorder(from, ids) {
            ops.push(() => reorderLinks(from, ids));
          },
        },
      };
      const result = await run(tx);
      if (ops.length > 500) throw new Error("一次最多 500 条写入");
      const snapshot = state;
      state = {
        entities: new Map([...snapshot.entities].map(([key, row]) => [key, clone(row)])),
        records: new Map([...snapshot.records].map(([key, row]) => [key, clone(row)])),
        links: new Map([...snapshot.links].map(([key, row]) => [key, clone(row)])),
      };
      try {
        ops.forEach(op => op());
      } catch (error) {
        state = snapshot;
        throw error;
      }
      commits += 1;
      return result;
    },
  };
  let commits = 0;

  return {
    store,
    /** 已提交的事务数 */
    commits: () => commits,
    rows: () => ({
      entities: [...state.entities.values()],
      records: [...state.records.values()],
      links: [...state.links.values()],
    }),
  };
}
