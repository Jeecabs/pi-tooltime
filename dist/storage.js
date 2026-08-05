import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { sanitizeTaskTrace } from "./core/sanitize.js";
const STORAGE_MODE = 0o700;
const TRACE_MODE = 0o600;
const READ_CHUNK_BYTES = 64 * 1_024;
const MAX_TRACE_LINE_BYTES = 4 * 1_024 * 1_024;
const MAX_ACTIVE_FILE_BYTES = 16 * 1_024 * 1_024;
const MAX_LOAD_BYTES = 32 * 1_024 * 1_024;
function projectKeyForCwd(cwd) {
    return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 20);
}
function safeSessionId(sessionId) {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 100);
    return safe || "ephemeral";
}
function pathContainedBy(root, candidate) {
    const fromRoot = relative(root, candidate);
    return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}
async function assertSafeDirectoryPath(path, projectRoot) {
    const absolute = resolve(path);
    const root = parse(absolute).root;
    const projectIsFilesystemRoot = resolve(projectRoot) === root;
    const userId = typeof process.getuid === "function" ? process.getuid() : undefined;
    let current = root;
    for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
        current = join(current, part);
        let info;
        try {
            info = await lstat(current);
        }
        catch (error) {
            if (error.code === "ENOENT")
                return;
            throw error;
        }
        if (!info.isSymbolicLink())
            continue;
        const insideProject = !projectIsFilesystemRoot && pathContainedBy(resolve(projectRoot), current);
        const trustedSystemLink = !insideProject && userId !== undefined && userId !== 0 && info.uid === 0;
        if (!trustedSystemLink)
            throw new Error(`Unsafe Tooltime storage directory: ${current}`);
    }
}
function parseTraceLine(line) {
    try {
        return sanitizeTaskTrace(JSON.parse(line));
    }
    catch {
        return undefined;
    }
}
async function openRegularFile(path, flags, mode) {
    const handle = await open(path, flags | constants.O_NOFOLLOW, mode);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1)
            throw new Error(`Unsafe Tooltime trace file: ${path}`);
        return { handle, info };
    }
    catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
    }
}
function consumeTailPiece(state, input, maxLines) {
    let piece = input;
    if (state.droppingOversizedLine) {
        const boundary = piece.lastIndexOf(0x0a);
        if (boundary < 0)
            return;
        piece = piece.subarray(0, boundary);
        state.droppingOversizedLine = false;
    }
    let combined = state.carry.length > 0 ? Buffer.concat([piece, state.carry]) : piece;
    let newline = combined.lastIndexOf(0x0a);
    while (newline >= 0 && state.lines.length < maxLines) {
        const line = combined.subarray(newline + 1);
        if (line.length > 0 && line.length <= MAX_TRACE_LINE_BYTES)
            state.lines.push(line.toString("utf8"));
        combined = combined.subarray(0, newline);
        newline = combined.lastIndexOf(0x0a);
    }
    state.carry = combined;
    if (state.carry.length > MAX_TRACE_LINE_BYTES) {
        state.carry = Buffer.alloc(0);
        state.droppingOversizedLine = true;
    }
}
async function readTailLines(path, maxLines, maxBytes) {
    const { handle, info } = await openRegularFile(path, constants.O_RDONLY);
    try {
        await handle.chmod(TRACE_MODE);
        const state = { lines: [], carry: Buffer.alloc(0), droppingOversizedLine: false };
        let position = info.size;
        let bytesReadTotal = 0;
        while (position > 0 && state.lines.length < maxLines && bytesReadTotal < maxBytes) {
            const length = Math.min(READ_CHUNK_BYTES, position, maxBytes - bytesReadTotal);
            if (length <= 0)
                break;
            const start = position - length;
            const chunk = Buffer.allocUnsafe(length);
            const result = await handle.read(chunk, 0, length, start);
            if (result.bytesRead <= 0)
                break;
            position = start;
            bytesReadTotal += result.bytesRead;
            consumeTailPiece(state, chunk.subarray(0, result.bytesRead), maxLines);
        }
        if (position === 0 && !state.droppingOversizedLine && state.carry.length > 0 && state.carry.length <= MAX_TRACE_LINE_BYTES && state.lines.length < maxLines) {
            state.lines.push(state.carry.toString("utf8"));
        }
        return { lines: state.lines, bytesRead: bytesReadTotal, size: info.size, complete: position === 0 };
    }
    finally {
        await handle.close();
    }
}
function addCompactionLine(state, line, cutoff, maxTasks) {
    const trace = parseTraceLine(line);
    if (!trace || Date.parse(trace.completedAt) < cutoff) {
        state.changed = true;
        return true;
    }
    if (state.newest.length >= maxTasks) {
        state.changed = true;
        return false;
    }
    const normalized = JSON.stringify(trace);
    const serialized = `${normalized}\n`;
    const bytes = Buffer.byteLength(serialized);
    if (normalized !== line || bytes > MAX_TRACE_LINE_BYTES || state.totalBytes + bytes > MAX_ACTIVE_FILE_BYTES)
        state.changed = true;
    if (bytes > MAX_TRACE_LINE_BYTES || state.totalBytes + bytes > MAX_ACTIVE_FILE_BYTES)
        return true;
    state.newest.push(serialized);
    state.totalBytes += bytes;
    return true;
}
export class TooltimeStore {
    projectDir;
    filePath;
    agentDir;
    projectRoot;
    stateDir;
    tooltimeDir;
    retentionDays;
    maxTasks;
    now;
    pending = Promise.resolve();
    lastError;
    activeTraceCount;
    constructor(options) {
        this.agentDir = resolve(options.agentDir);
        this.projectRoot = resolve(options.cwd);
        this.stateDir = join(this.agentDir, "state");
        this.tooltimeDir = join(this.stateDir, "pi-tooltime");
        this.projectDir = join(this.tooltimeDir, projectKeyForCwd(options.cwd));
        this.filePath = join(this.projectDir, `${safeSessionId(options.sessionId)}-${randomUUID()}.jsonl`);
        this.retentionDays = Math.max(1, options.retentionDays);
        this.maxTasks = Math.max(1, options.maxTasks);
        this.now = options.now ?? Date.now;
    }
    async ensureStorageDirectory() {
        await assertSafeDirectoryPath(this.agentDir, this.projectRoot);
        await mkdir(this.agentDir, { recursive: true, mode: STORAGE_MODE });
        await assertSafeDirectoryPath(this.agentDir, this.projectRoot);
        const agentInfo = await lstat(this.agentDir);
        if (agentInfo.isSymbolicLink() || !agentInfo.isDirectory()) {
            throw new Error(`Unsafe Tooltime storage directory: ${this.agentDir}`);
        }
        for (const path of [this.stateDir, this.tooltimeDir, this.projectDir]) {
            await assertSafeDirectoryPath(path, this.projectRoot);
            try {
                await mkdir(path, { mode: STORAGE_MODE });
            }
            catch (error) {
                if (error.code !== "EEXIST")
                    throw error;
            }
            await assertSafeDirectoryPath(path, this.projectRoot);
            const info = await lstat(path);
            if (info.isSymbolicLink() || !info.isDirectory())
                throw new Error(`Unsafe Tooltime storage directory: ${path}`);
            await chmod(path, STORAGE_MODE);
        }
    }
    async appendLine(line) {
        const { handle } = await openRegularFile(this.filePath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, TRACE_MODE);
        try {
            await handle.chmod(TRACE_MODE);
            await handle.writeFile(line, "utf8");
            return (await handle.stat()).size;
        }
        finally {
            await handle.close();
        }
    }
    async replaceActiveFile(content) {
        const temporary = join(this.projectDir, `.${safeSessionId(randomUUID())}.tmp`);
        let created = false;
        try {
            const { handle } = await openRegularFile(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, TRACE_MODE);
            created = true;
            try {
                await handle.chmod(TRACE_MODE);
                await handle.writeFile(content, "utf8");
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            await rename(temporary, this.filePath);
            created = false;
        }
        finally {
            if (created)
                await unlink(temporary).catch(() => undefined);
        }
    }
    async compactActiveFile(ignoreMissing = false) {
        let tail;
        try {
            tail = await readTailLines(this.filePath, this.maxTasks * 2, MAX_LOAD_BYTES);
        }
        catch (error) {
            if (ignoreMissing && error.code === "ENOENT")
                return;
            throw error;
        }
        const cutoff = this.now() - this.retentionDays * 24 * 60 * 60 * 1_000;
        const state = {
            newest: [],
            totalBytes: 0,
            changed: !tail.complete || tail.size > MAX_ACTIVE_FILE_BYTES || tail.lines.length > this.maxTasks,
        };
        for (const line of tail.lines) {
            if (!addCompactionLine(state, line, cutoff, this.maxTasks))
                break;
        }
        const content = state.newest.reverse().join("");
        if (Buffer.byteLength(content) !== tail.size)
            state.changed = true;
        if (state.changed)
            await this.replaceActiveFile(content);
        this.activeTraceCount = state.newest.length;
    }
    schedule(trace) {
        const stored = sanitizeTaskTrace(trace);
        if (!stored) {
            this.lastError = new Error("Invalid Tooltime trace was not stored.");
            return;
        }
        const line = `${JSON.stringify(stored)}\n`;
        if (Buffer.byteLength(line) > MAX_TRACE_LINE_BYTES) {
            this.lastError = new Error("Tooltime trace exceeds the local size limit.");
            return;
        }
        this.pending = this.pending.then(async () => {
            await this.ensureStorageDirectory();
            const size = await this.appendLine(line);
            if (this.activeTraceCount === undefined) {
                const tail = await readTailLines(this.filePath, this.maxTasks + 1, MAX_LOAD_BYTES);
                this.activeTraceCount = tail.lines.length;
            }
            else {
                this.activeTraceCount++;
            }
            if (this.activeTraceCount > this.maxTasks || size > MAX_ACTIVE_FILE_BYTES)
                await this.compactActiveFile();
        }).catch((error) => {
            this.lastError = error instanceof Error ? error : new Error(String(error));
        });
    }
    async flush() {
        await this.pending;
    }
    error() {
        return this.lastError;
    }
    async load() {
        await this.flush();
        const cutoff = this.now() - this.retentionDays * 24 * 60 * 60 * 1_000;
        try {
            await this.ensureStorageDirectory();
            await this.compactActiveFile(true);
        }
        catch (error) {
            this.lastError = error instanceof Error ? error : new Error(String(error));
            return [];
        }
        let entries;
        try {
            entries = await readdir(this.projectDir, { withFileTypes: true });
        }
        catch (error) {
            this.lastError = error instanceof Error ? error : new Error(String(error));
            return [];
        }
        const recentFiles = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(".jsonl"))
                continue;
            const path = join(this.projectDir, entry.name);
            try {
                const { handle, info } = await openRegularFile(path, constants.O_RDONLY);
                try {
                    await handle.chmod(TRACE_MODE);
                }
                finally {
                    await handle.close();
                }
                if (info.mtimeMs < cutoff && path !== this.filePath)
                    await unlink(path).catch(() => undefined);
                else
                    recentFiles.push({ path, mtimeMs: info.mtimeMs });
            }
            catch (error) {
                this.lastError = error instanceof Error ? error : new Error(String(error));
            }
        }
        recentFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const traces = [];
        const candidateLimit = this.maxTasks * 2;
        let byteBudget = MAX_LOAD_BYTES;
        for (const file of recentFiles) {
            if (traces.length >= candidateLimit || byteBudget <= 0)
                break;
            try {
                const tail = await readTailLines(file.path, candidateLimit - traces.length, byteBudget);
                byteBudget -= tail.bytesRead;
                for (const line of tail.lines) {
                    const trace = parseTraceLine(line);
                    if (trace && Date.parse(trace.completedAt) >= cutoff)
                        traces.push(trace);
                }
            }
            catch (error) {
                this.lastError = error instanceof Error ? error : new Error(String(error));
            }
        }
        return traces
            .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
            .slice(0, this.maxTasks);
    }
}
