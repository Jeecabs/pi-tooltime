import type { TaskTrace } from "./core/types.js";
export interface TooltimeStoreOptions {
    agentDir: string;
    cwd: string;
    sessionId: string;
    retentionDays: number;
    maxTasks: number;
    now?: () => number;
}
export declare class TooltimeStore {
    readonly projectDir: string;
    readonly filePath: string;
    private readonly agentDir;
    private readonly projectRoot;
    private readonly stateDir;
    private readonly tooltimeDir;
    private readonly retentionDays;
    private readonly maxTasks;
    private readonly now;
    private pending;
    private lastError;
    private activeTraceCount;
    constructor(options: TooltimeStoreOptions);
    private ensureStorageDirectory;
    private enqueue;
    private appendLine;
    private replaceActiveFile;
    private compactActiveFile;
    schedule(trace: TaskTrace): void;
    flush(): Promise<void>;
    error(): Error | undefined;
    load(): Promise<TaskTrace[]>;
}
