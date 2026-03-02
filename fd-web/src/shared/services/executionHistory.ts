/**
 * Agent 执行历史 -- 本地存储服务
 *
 * 使用 IndexedDB 存储 Agent 执行记录，不上传服务端。
 * 如果 IndexedDB 不可用（如 SSR），降级为 localStorage（保留最近 50 条）。
 */

// ─── 数据结构 ─────────────────────────────────────────────

export interface AgentExecutionRecord {
    id: string;           // UUID
    agentCode: string;
    agentName: string;
    capability: string;   // 业务意图 / taskType
    status: 'running' | 'completed' | 'failed' | 'timeout';
    inputSummary: string; // 输入摘要（前 200 字符）
    outputSummary: string; // 输出摘要（前 500 字符）
    fullInput?: string;   // 完整输入（JSON）
    fullOutput?: string;  // 完整输出
    errorMessage?: string;
    startTime: number;    // timestamp ms
    endTime?: number;
    durationMs?: number;
    clientId: string;
    ticketId?: number;
    ticketSubject?: string;
    routeInfo?: {
        resolvedAgentCode: string;
        resolvedClientId: string;
        requiredCapability: string;
    };
}

export interface QueryOptions {
    agentCode?: string;
    status?: AgentExecutionRecord['status'];
    startTimeFrom?: number;
    startTimeTo?: number;
    offset?: number;
    limit?: number;
}

// ─── 常量 ──────────────────────────────────────────────────

const DB_NAME = 'fd_agent_execution';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const MAX_RECORDS = 1000;
const LS_KEY = 'fd_agent_execution_records';
const LS_MAX_RECORDS = 50;

// ─── IndexedDB 封装 ────────────────────────────────────────

let dbInstance: IDBDatabase | null = null;
let dbFailed = false;

function openDB(): Promise<IDBDatabase> {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('startTime', 'startTime', { unique: false });
                    store.createIndex('agentCode', 'agentCode', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                    store.createIndex('capability', 'capability', { unique: false });
                }
            };

            request.onsuccess = () => {
                dbInstance = request.result;
                // 数据库意外关闭时重置实例
                dbInstance.onclose = () => { dbInstance = null; };
                resolve(dbInstance);
            };

            request.onerror = () => {
                dbFailed = true;
                reject(request.error);
            };
        } catch (e) {
            dbFailed = true;
            reject(e);
        }
    });
}

function txStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return openDB().then(db => {
        const tx = db.transaction(STORE_NAME, mode);
        return tx.objectStore(STORE_NAME);
    });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ─── localStorage 降级 ──────────────────────────────────────

function lsGetAll(): AgentExecutionRecord[] {
    try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function lsSave(records: AgentExecutionRecord[]) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(records.slice(0, LS_MAX_RECORDS)));
    } catch { /* quota exceeded, ignore */ }
}

// ─── 公开 API ───────────────────────────────────────────────

/**
 * 添加一条执行记录
 */
export async function addRecord(record: AgentExecutionRecord): Promise<void> {
    if (dbFailed) {
        const all = lsGetAll();
        all.unshift(record);
        lsSave(all);
        return;
    }

    try {
        const store = await txStore('readwrite');
        await idbRequest(store.put(record));
        // 超限清理
        await enforceMaxRecords();
    } catch {
        // IndexedDB 写入失败，降级
        dbFailed = true;
        const all = lsGetAll();
        all.unshift(record);
        lsSave(all);
    }
}

/**
 * 更新一条记录（部分字段）
 */
export async function updateRecord(id: string, patch: Partial<AgentExecutionRecord>): Promise<void> {
    if (dbFailed) {
        const all = lsGetAll();
        const idx = all.findIndex(r => r.id === id);
        if (idx >= 0) {
            all[idx] = { ...all[idx], ...patch };
            lsSave(all);
        }
        return;
    }

    try {
        const store = await txStore('readwrite');
        const existing = await idbRequest(store.get(id)) as AgentExecutionRecord | undefined;
        if (existing) {
            await idbRequest(store.put({ ...existing, ...patch }));
        }
    } catch {
        dbFailed = true;
        // 降级尝试
        const all = lsGetAll();
        const idx = all.findIndex(r => r.id === id);
        if (idx >= 0) {
            all[idx] = { ...all[idx], ...patch };
            lsSave(all);
        }
    }
}

/**
 * 获取单条记录
 */
export async function getRecord(id: string): Promise<AgentExecutionRecord | undefined> {
    if (dbFailed) {
        return lsGetAll().find(r => r.id === id);
    }

    try {
        const store = await txStore('readonly');
        return await idbRequest(store.get(id)) as AgentExecutionRecord | undefined;
    } catch {
        return lsGetAll().find(r => r.id === id);
    }
}

/**
 * 分页查询记录（按 startTime 降序）
 */
export async function getRecords(options: QueryOptions = {}): Promise<{
    records: AgentExecutionRecord[];
    total: number;
}> {
    const { agentCode, status, startTimeFrom, startTimeTo, offset = 0, limit = 50 } = options;

    if (dbFailed) {
        let all = lsGetAll();
        all = applyFilters(all, { agentCode, status, startTimeFrom, startTimeTo });
        all.sort((a, b) => b.startTime - a.startTime);
        return { records: all.slice(offset, offset + limit), total: all.length };
    }

    try {
        const store = await txStore('readonly');
        const all = await idbRequest(store.index('startTime').getAll()) as AgentExecutionRecord[];

        // 降序排列
        all.sort((a, b) => b.startTime - a.startTime);

        // 过滤
        const filtered = applyFilters(all, { agentCode, status, startTimeFrom, startTimeTo });

        return {
            records: filtered.slice(offset, offset + limit),
            total: filtered.length,
        };
    } catch {
        dbFailed = true;
        let all = lsGetAll();
        all = applyFilters(all, { agentCode, status, startTimeFrom, startTimeTo });
        all.sort((a, b) => b.startTime - a.startTime);
        return { records: all.slice(offset, offset + limit), total: all.length };
    }
}

/**
 * 获取所有不重复的 agentCode 列表（用于筛选下拉）
 */
export async function getDistinctAgentCodes(): Promise<string[]> {
    if (dbFailed) {
        const all = lsGetAll();
        return [...new Set(all.map(r => r.agentCode))];
    }

    try {
        const store = await txStore('readonly');
        const all = await idbRequest(store.getAll()) as AgentExecutionRecord[];
        return [...new Set(all.map(r => r.agentCode))];
    } catch {
        const all = lsGetAll();
        return [...new Set(all.map(r => r.agentCode))];
    }
}

/**
 * 清理超过 N 天的旧记录
 */
export async function clearOldRecords(daysToKeep: number = 30): Promise<number> {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    if (dbFailed) {
        const all = lsGetAll();
        const filtered = all.filter(r => r.startTime >= cutoff);
        const removed = all.length - filtered.length;
        lsSave(filtered);
        return removed;
    }

    try {
        const store = await txStore('readwrite');
        const all = await idbRequest(store.index('startTime').getAll()) as AgentExecutionRecord[];
        let removed = 0;
        for (const record of all) {
            if (record.startTime < cutoff) {
                await idbRequest(store.delete(record.id));
                removed++;
            }
        }
        return removed;
    } catch {
        return 0;
    }
}

/**
 * 清除所有记录
 */
export async function clearAllRecords(): Promise<void> {
    if (dbFailed) {
        localStorage.removeItem(LS_KEY);
        return;
    }

    try {
        const store = await txStore('readwrite');
        await idbRequest(store.clear());
    } catch {
        localStorage.removeItem(LS_KEY);
    }
}

// ─── 内部工具 ───────────────────────────────────────────────

function applyFilters(
    records: AgentExecutionRecord[],
    filters: Pick<QueryOptions, 'agentCode' | 'status' | 'startTimeFrom' | 'startTimeTo'>,
): AgentExecutionRecord[] {
    let result = records;
    if (filters.agentCode) {
        result = result.filter(r => r.agentCode === filters.agentCode);
    }
    if (filters.status) {
        result = result.filter(r => r.status === filters.status);
    }
    if (filters.startTimeFrom) {
        result = result.filter(r => r.startTime >= filters.startTimeFrom!);
    }
    if (filters.startTimeTo) {
        result = result.filter(r => r.startTime <= filters.startTimeTo!);
    }
    return result;
}

/**
 * 保持记录数不超过 MAX_RECORDS，删除最旧的记录
 */
async function enforceMaxRecords(): Promise<void> {
    try {
        const store = await txStore('readwrite');
        const countReq = store.count();
        const count = await idbRequest(countReq);
        if (count <= MAX_RECORDS) return;

        // 按 startTime 升序获取要删除的数量
        const toRemove = count - MAX_RECORDS;
        const index = store.index('startTime');
        const cursor = index.openCursor(); // 升序（最旧在前）
        let removed = 0;

        await new Promise<void>((resolve, reject) => {
            cursor.onsuccess = () => {
                const c = cursor.result;
                if (c && removed < toRemove) {
                    c.delete();
                    removed++;
                    c.continue();
                } else {
                    resolve();
                }
            };
            cursor.onerror = () => reject(cursor.error);
        });
    } catch {
        // best-effort
    }
}
