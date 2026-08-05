import { homedir } from "node:os";
import { isAbsolute, parse, relative, resolve } from "node:path";
import { toolFingerprint } from "./fingerprint.js";
import { normalizeToolName } from "./policy.js";
export { toolFingerprint } from "./fingerprint.js";
function stringField(input, key) {
    if (!input || typeof input !== "object")
        return undefined;
    const value = input[key];
    return typeof value === "string" ? value : undefined;
}
function booleanField(input, key) {
    if (!input || typeof input !== "object")
        return undefined;
    const value = input[key];
    return typeof value === "boolean" ? value : undefined;
}
function pathScope(path, cwd) {
    if (!path || path === ".")
        return "project";
    if (path === "/" || path === "~" || path === homedir())
        return "root";
    const expanded = path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(cwd, path);
    if (expanded === parse(expanded).root)
        return "root";
    const fromProject = relative(resolve(cwd), expanded);
    if (fromProject === "")
        return "project";
    if (fromProject === ".." || fromProject.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromProject)) {
        return "outside";
    }
    return "targeted";
}
function isTargetedTest(command) {
    return /(?:--filter|--test-name-pattern|--testNamePattern|--testPathPattern|--runTestsByPath|-t\s+|::|\b(?:src|test|tests|spec|packages)\/[^\s]+|\.(?:test|spec)\.[cm]?[jt]sx?\b)/iu.test(command);
}
function isTestCommand(command) {
    return /(?:^|[;&|]\s*)(?:(?:[A-Z_][A-Z0-9_]*=\S+)\s+)*(?:(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|verify|check)|pytest\b|cargo\s+test\b|go\s+test\b|dotnet\s+test\b|(?:mvn|mvnw)\s+test\b|(?:gradle|gradlew)\s+test\b|node\s+--test\b)/iu.test(command.trim());
}
function isSearchCommand(command) {
    return lexShell(command).commands.some((words) => ["rg", "grep", "find"].includes(words[0]?.toLowerCase() ?? ""));
}
function finishShellWord(state) {
    if (!state.wordStarted)
        return;
    state.words.push(state.word);
    state.word = "";
    state.wordStarted = false;
}
function finishShellCommand(state) {
    finishShellWord(state);
    if (state.words.length > 0)
        state.commands.push(state.words);
    state.words = [];
}
function appendEscapedShellCharacter(state, character) {
    state.word += character;
    state.wordStarted = true;
    state.escaped = false;
}
function consumeSingleQuotedShellCharacter(state, character) {
    if (character === "'")
        state.quote = undefined;
    else
        state.word += character;
}
function consumeAnsiQuotedShellCharacter(state, character) {
    if (character === "\\")
        state.escaped = true;
    else if (character === "'")
        state.quote = undefined;
    else
        state.word += character;
}
function consumeDoubleQuotedShellCharacter(state, character, next) {
    if (character === "\\") {
        state.escaped = true;
        return;
    }
    if (character === "\"")
        state.quote = undefined;
    else
        state.word += character;
    if (character === "`" || (character === "$" && next === "("))
        state.hasEffect = true;
}
function consumeQuotedShellCharacter(state, character, next) {
    if (state.quote === "single")
        consumeSingleQuotedShellCharacter(state, character);
    else if (state.quote === "ansi-single")
        consumeAnsiQuotedShellCharacter(state, character);
    else
        consumeDoubleQuotedShellCharacter(state, character, next);
}
function consumeUnquotedShellCharacter(state, character, next) {
    if (character === "\\") {
        state.escaped = true;
        state.wordStarted = true;
        return false;
    }
    if (character === "$" && next === "'") {
        state.quote = "ansi-single";
        state.wordStarted = true;
        return true;
    }
    if (character === "'" || character === "\"") {
        state.quote = character === "'" ? "single" : "double";
        state.wordStarted = true;
        return false;
    }
    if (character === "\n" || ";&|<>".includes(character)) {
        state.hasEffect = true;
        finishShellCommand(state);
        return false;
    }
    if (/\s/u.test(character)) {
        finishShellWord(state);
        return false;
    }
    if (character === "`" || (character === "$" && next === "("))
        state.hasEffect = true;
    state.word += character;
    state.wordStarted = true;
    return false;
}
function lexShell(command) {
    const state = {
        commands: [],
        words: [],
        word: "",
        wordStarted: false,
        escaped: false,
        hasEffect: false,
    };
    for (let index = 0; index < command.length; index++) {
        const character = command[index];
        const next = command[index + 1];
        if (state.escaped)
            appendEscapedShellCharacter(state, character);
        else if (state.quote)
            consumeQuotedShellCharacter(state, character, next);
        else if (consumeUnquotedShellCharacter(state, character, next))
            index++;
    }
    finishShellCommand(state);
    return {
        commands: state.commands,
        hasEffect: state.hasEffect,
        malformed: state.quote !== undefined || state.escaped,
    };
}
const SEARCH_OPTION_VALUES = new Set([
    "-e", "--regexp", "-f", "--file", "-g", "--glob", "--iglob", "--ignore-file",
    "-A", "-B", "-C", "--after-context", "--before-context", "--context",
    "-m", "--max-count", "--max-depth", "--max-filesize", "-j", "--threads",
    "-t", "-T", "--type", "--type-add", "--type-clear", "--replace",
    "--encoding", "--engine", "--sort", "--sortr", "--pre", "--pre-glob",
    "--color", "--colors", "--context-separator", "--field-context-separator", "--field-match-separator",
    "--exclude", "--include", "--exclude-dir", "--include-dir", "--exclude-from", "--label",
]);
const SEARCH_PATTERN_OPTIONS = new Set(["-e", "--regexp", "-f", "--file"]);
const SEARCH_PATH_ONLY_OPTIONS = new Set(["--files"]);
function findOperands(args) {
    const paths = [];
    for (const arg of args) {
        if (["-H", "-L", "-P", "--"].includes(arg) && paths.length === 0)
            continue;
        if (arg.startsWith("-") || arg === "!" || arg === "(")
            break;
        paths.push(arg);
    }
    return paths;
}
function consumeSearchArgument(state, arg) {
    if (state.pendingOption) {
        if (SEARCH_PATTERN_OPTIONS.has(state.pendingOption))
            state.patternSeen = true;
        state.pendingOption = undefined;
        return;
    }
    if (!state.optionsEnded && arg === "--") {
        state.optionsEnded = true;
        return;
    }
    if (!state.optionsEnded && arg.startsWith("-") && arg !== "-") {
        const option = arg.split("=", 1)[0];
        if (SEARCH_PATH_ONLY_OPTIONS.has(option))
            state.patternSeen = true;
        else if (/^-[ef].+/u.test(arg) || (SEARCH_PATTERN_OPTIONS.has(option) && arg.includes("=")))
            state.patternSeen = true;
        else if (SEARCH_OPTION_VALUES.has(option) && !arg.includes("="))
            state.pendingOption = option;
        return;
    }
    if (!state.patternSeen) {
        state.patternSeen = true;
        return;
    }
    state.paths.push(arg);
}
function patternSearchOperands(args) {
    const state = { paths: [], patternSeen: false, optionsEnded: false };
    for (const arg of args)
        consumeSearchArgument(state, arg);
    return state.paths;
}
function searchOperands(tool, args) {
    return tool === "find" ? findOperands(args) : patternSearchOperands(args);
}
function explicitSearchOperandScope(rawWord, cwd) {
    const word = rawWord.replace(/^[<(]+|[>),]+$/gu, "");
    const explicit = word === ".." || word.startsWith("../") || word === "~" || word.startsWith("~/") || isAbsolute(word);
    return explicit ? pathScope(word, cwd) : undefined;
}
function bashSearchScope(command, cwd) {
    let broadest = "project";
    for (const words of lexShell(command).commands) {
        const tool = words[0]?.toLowerCase() ?? "";
        if (!["rg", "grep", "find"].includes(tool))
            continue;
        for (const rawWord of searchOperands(tool, words.slice(1))) {
            const scope = explicitSearchOperandScope(rawWord, cwd);
            if (scope === "root")
                return "root";
            if (scope === "outside")
                broadest = "outside";
        }
    }
    return broadest;
}
function hasShellSideEffects(command) {
    const result = lexShell(command);
    return result.hasEffect || result.malformed;
}
function searchMutates(command) {
    return hasShellSideEffects(command)
        || /(?:^|[;&|]\s*)find\b[^;&|]*(?:-delete|-exec(?:dir)?|-ok(?:dir)?)(?:\s|$)/iu.test(command);
}
function isSimpleShellRead(command) {
    if (hasShellSideEffects(command))
        return false;
    return /^\s*(?:git\s+(?:status|diff|log|show)\b.*|ls\b.*|pwd\s*|wc\b.*|head\b.*|tail\b.*|cat\b.*)\s*$/iu.test(command);
}
function classifyBash(command, cwd) {
    if (isTestCommand(command)) {
        const targeted = isTargetedTest(command);
        return {
            family: "test",
            operation: targeted ? "test-targeted" : "test-full",
            scope: targeted ? "targeted" : "full",
            mutates: hasShellSideEffects(command),
        };
    }
    if (isSearchCommand(command)) {
        return {
            family: "repository",
            operation: "search",
            scope: bashSearchScope(command, cwd),
            mutates: searchMutates(command),
        };
    }
    if (/(?:^|[;&|]\s*)(?:curl|wget)\b/iu.test(command.trim())) {
        const forcesGet = /(?:^|\s)(?:-G|--get)(?=$|\s)/u.test(command);
        const writeMethod = /(?:--request(?:=|\s+)|--method(?:=|\s+)|-X\s*)(?:POST|PUT|PATCH|DELETE)\b/iu.test(command);
        const body = /(?:^|\s)(?:--data(?:-ascii|-raw|-binary|-urlencode)?|--body-(?:data|file)|--form(?:-string)?|--json)(?:=|\s|$)/iu.test(command)
            || /(?:^|\s)-[dF](?:$|\s|\S)/u.test(command)
            || /(?:^|\s)--post-(?:data|file)(?:=|\s|$)/iu.test(command);
        const upload = /(?:^|\s)(?:--upload-file(?:=|\s)|-T(?:$|\s|\S))/u.test(command);
        const localWrite = /(?:^|\s)(?:--output|--remote-name|-o|-O)(?:=|\s|\S)/u.test(command)
            || /(?:^|[;&|]\s*)wget\b/iu.test(command.trim())
            || hasShellSideEffects(command);
        return { family: "web", operation: "request", mutates: localWrite || writeMethod || upload || (body && !forcesGet) };
    }
    if (/(?:^|[;&|]\s*)(?:psql|mysql|sqlite3|supabase)\b/iu.test(command.trim())) {
        const readOnly = /\b(?:SELECT|SHOW|EXPLAIN|WITH)\b/iu.test(command)
            && !/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/iu.test(command);
        return { family: "database", operation: "query", mutates: hasShellSideEffects(command) || !readOnly };
    }
    if (isSimpleShellRead(command))
        return { family: "shell", operation: "read", mutates: false };
    return { family: "shell", operation: "command", mutates: true };
}
function familyFromName(toolName) {
    if (["read", "grep", "find", "ls", "edit", "write"].includes(toolName) || toolName.startsWith("fallow_"))
        return "repository";
    if (toolName.startsWith("browser_") || toolName.startsWith("research_"))
        return "web";
    if (toolName.startsWith("supabase_") || toolName.startsWith("posthog_") || /(?:database|postgres|sql)_/u.test(toolName))
        return "database";
    if (toolName.startsWith("linear_"))
        return "issues";
    if (toolName.startsWith("whiskd_"))
        return "process";
    return "other";
}
const READ_ACTIONS = new Set(["get", "read", "list", "show", "inspect", "status", "logs", "browse", "snapshot", "pending", "resolve", "templates", "scope", "endpoints", "probe"]);
const SEARCH_ACTIONS = new Set(["search", "find"]);
const QUERY_ACTIONS = new Set(["query", "schema", "tables"]);
const MUTATING_ACTIONS = new Set(["create", "update", "write", "edit", "delete", "remove", "replace", "trash", "apply", "add", "start", "stop", "fill", "type", "click", "hover", "focus", "check", "uncheck", "send", "ask", "reply", "publish", "upload", "import_url", "select", "press", "navigate", "set", "open", "scroll", "record", "trace", "har", "spawn", "clean", "save", "restore", "load", "rename", "connect", "disconnect", "notify", "message", "pair", "switch", "new", "close", "back", "forward", "reload", "pushstate"]);
function fromAction(action, family) {
    if (READ_ACTIONS.has(action))
        return { operation: "read", mutates: false };
    if (SEARCH_ACTIONS.has(action))
        return { operation: family === "database" ? "query" : "search", mutates: false };
    if (QUERY_ACTIONS.has(action))
        return { operation: "query", mutates: false };
    if (MUTATING_ACTIONS.has(action))
        return { operation: family === "web" ? "interact" : "mutate", mutates: true };
    return { operation: "unknown", mutates: true };
}
const DIRECT_TOOL_OPERATIONS = new Map([
    ["read", { operation: "read", mutates: false }],
    ["ls", { operation: "read", mutates: false }],
    ["grep", { operation: "search", mutates: false }],
    ["find", { operation: "search", mutates: false }],
    ["edit", { operation: "mutate", mutates: true }],
    ["write", { operation: "mutate", mutates: true }],
    ["tooltime_report", { operation: "report", mutates: false }],
]);
const WEB_READ_SUFFIXES = new Set(["read", "search", "get", "snapshot", "status"]);
const WEB_MUTATION_SUFFIXES = new Set(["click", "fill", "select", "press", "navigate", "set", "open", "scroll", "record", "trace", "har"]);
const DATABASE_READ_SUFFIXES = new Set(["query", "search", "schema", "tables", "status"]);
const ISSUE_READ_SUFFIXES = new Set(["search", "get", "list"]);
const PROCESS_READ_SUFFIXES = new Set(["status", "logs"]);
function webToolOperation(suffix) {
    if (WEB_READ_SUFFIXES.has(suffix))
        return { operation: suffix === "search" ? "search" : "read", mutates: false };
    if (WEB_MUTATION_SUFFIXES.has(suffix))
        return { operation: "interact", mutates: true };
    return undefined;
}
function familyToolOperation(family, suffix) {
    if (family === "web")
        return webToolOperation(suffix);
    if (family === "database" && DATABASE_READ_SUFFIXES.has(suffix))
        return { operation: "query", mutates: false };
    if (family === "issues" && ISSUE_READ_SUFFIXES.has(suffix))
        return { operation: "read", mutates: false };
    if (family === "process" && PROCESS_READ_SUFFIXES.has(suffix))
        return { operation: "read", mutates: false };
    return undefined;
}
function fromToolName(toolName, family) {
    const direct = DIRECT_TOOL_OPERATIONS.get(toolName);
    if (direct)
        return direct;
    if (toolName.startsWith("fallow_"))
        return { operation: "analyze", mutates: false };
    const suffix = toolName.split("_").at(-1) ?? "";
    return familyToolOperation(family, suffix) ?? { operation: "unknown", mutates: true };
}
export function classifyToolCall(toolName, input, cwd) {
    const fingerprint = toolFingerprint(toolName, input);
    if (toolName === "bash") {
        const command = stringField(input, "command") ?? "";
        return { toolName: "bash", fingerprint, ...classifyBash(command, cwd) };
    }
    const family = familyFromName(toolName);
    if (toolName === "fallow_fix") {
        const mutates = booleanField(input, "dryRun") === false;
        return {
            toolName: normalizeToolName(toolName, family),
            fingerprint,
            family,
            operation: mutates ? "mutate" : "analyze",
            scope: "project",
            mutates,
        };
    }
    const action = stringField(input, "action");
    const fixedOperation = DIRECT_TOOL_OPERATIONS.has(toolName) || toolName.startsWith("fallow_");
    const classification = fixedOperation || action === undefined
        ? fromToolName(toolName, family)
        : fromAction(action, family);
    let scope;
    if (["read", "grep", "find", "ls", "edit", "write"].includes(toolName)) {
        scope = pathScope(stringField(input, "path"), cwd);
    }
    else if (toolName.startsWith("fallow_")) {
        scope = "project";
    }
    return {
        toolName: normalizeToolName(toolName, family),
        fingerprint,
        family,
        ...classification,
        ...(scope ? { scope } : {}),
    };
}
export function classifyTaskIntent(prompt) {
    const web = [
        /\b(?:look|search|check|find|browse)\s+(?:it\s+)?(?:online|on the web|the web)\b/iu,
        /\bofficial\s+(?:docs|documentation|website)\b/iu,
        /\b(?:online|web)\s+(?:docs|documentation)\b/iu,
        /https?:\/\//iu,
    ].some((pattern) => pattern.test(prompt));
    const database = /\b(?:database|db|supabase|postgres(?:ql)?)\b/iu.test(prompt);
    const repository = /\b(?:repo|repository|codebase|source code)\b/iu.test(prompt);
    const matches = [web ? "web" : undefined, database ? "database" : undefined, repository ? "repository" : undefined]
        .filter((value) => value !== undefined);
    return matches.length === 1 ? matches[0] : undefined;
}
const MAX_RESULT_CLASSIFICATION_CHARS = 4_096;
const MAX_RESULT_CONTENT_ITEMS = 256;
function consumeResultItem(state, item) {
    if (!item || typeof item !== "object" || item.type !== "text") {
        if (item !== undefined && item !== null)
            state.hasOtherContent = true;
        return;
    }
    const value = item.text;
    if (typeof value !== "string") {
        state.hasOtherContent = true;
        return;
    }
    const available = state.remaining;
    if (available > 0) {
        const part = value.slice(0, available);
        state.text.push(part);
        state.remaining -= part.length;
    }
    if (value.length > available)
        state.truncated = true;
}
function resultText(result) {
    if (typeof result === "string") {
        return {
            text: result.slice(0, MAX_RESULT_CLASSIFICATION_CHARS),
            hasOtherContent: false,
            truncated: result.length > MAX_RESULT_CLASSIFICATION_CHARS,
        };
    }
    if (!result || typeof result !== "object") {
        return { text: "", hasOtherContent: result !== undefined && result !== null, truncated: false };
    }
    const content = result.content;
    if (!Array.isArray(content)) {
        return { text: "", hasOtherContent: Object.keys(result).length > 0, truncated: false };
    }
    const state = {
        text: [],
        remaining: MAX_RESULT_CLASSIFICATION_CHARS,
        hasOtherContent: false,
        truncated: content.length > MAX_RESULT_CONTENT_ITEMS,
    };
    for (const item of content.slice(0, MAX_RESULT_CONTENT_ITEMS))
        consumeResultItem(state, item);
    return { text: state.text.join("\n"), hasOtherContent: state.hasOtherContent, truncated: state.truncated };
}
export function classifyToolResult(result, isError) {
    if (isError)
        return "error";
    let extracted;
    try {
        extracted = resultText(result);
    }
    catch {
        return "unknown";
    }
    const { text, hasOtherContent, truncated } = extracted;
    if (truncated)
        return "nonempty";
    const normalized = text.trim();
    if (!normalized)
        return hasOtherContent ? "nonempty" : "empty";
    if (/^(?:\[\]|null|undefined|0\s+(?:matches|results))$/iu.test(normalized))
        return "empty";
    if (/\b(?:no matches found|no files found matching|no results found|produced no matches)\b/iu.test(normalized))
        return "empty";
    return "nonempty";
}
