import { createHmac, randomBytes } from "node:crypto";
const FINGERPRINT_DOMAIN = "pi-tooltime:tool-arguments:v1";
const LEGACY_FINGERPRINT_DOMAIN = "pi-tooltime:legacy-fingerprint:v1";
const FINGERPRINT_PREFIX = "h1:";
const PROCESS_FINGERPRINT_KEY = randomBytes(32);
const MAX_FINGERPRINT_DEPTH = 8;
const MAX_FINGERPRINT_NODES = 2_048;
const MAX_FINGERPRINT_CHARS = 32_768;
const MAX_OBJECT_KEYS = 200;
const MAX_ARRAY_ITEMS = 200;
const MAX_KEY_CHARS = 256;
const MAX_TOOL_NAME_CHARS = 256;
function budgetString(value, budget, maximum = value.length) {
    const length = Math.max(0, Math.min(value.length, maximum, budget.chars));
    budget.chars -= length;
    return value.slice(0, length);
}
function canonicalNonObject(value, budget) {
    if (value === null || typeof value === "number" || typeof value === "boolean")
        return { matched: true, value };
    if (typeof value === "string")
        return { matched: true, value: budgetString(value, budget) };
    if (typeof value === "bigint")
        return { matched: true, value: budgetString(value.toString(), budget) };
    if (typeof value === "object")
        return { matched: false };
    return { matched: true, value: budgetString(String(value), budget, 128) };
}
function canonicalArray(value, budget, depth, seen) {
    const output = [];
    const count = Math.min(value.length, MAX_ARRAY_ITEMS, budget.nodes);
    for (let index = 0; index < count && budget.nodes > 0 && budget.chars > 0; index++) {
        output.push(canonicalValue(value[index], budget, depth + 1, seen));
    }
    if (value.length > count)
        output.push("[budget-limit]");
    return output;
}
function canonicalObject(object, budget, depth, seen) {
    const keys = [];
    let visitedKeys = 0;
    for (const key in object) {
        visitedKeys++;
        if (Object.prototype.hasOwnProperty.call(object, key))
            keys.push(key);
        if (visitedKeys >= MAX_OBJECT_KEYS || keys.length >= budget.nodes)
            break;
    }
    keys.sort();
    const output = {};
    for (const rawKey of keys) {
        if (budget.nodes <= 0 || budget.chars <= 0)
            break;
        const key = budgetString(rawKey, budget, MAX_KEY_CHARS);
        const descriptor = Object.getOwnPropertyDescriptor(object, rawKey);
        output[key] = descriptor && "value" in descriptor
            ? canonicalValue(descriptor.value, budget, depth + 1, seen)
            : "[accessor]";
    }
    return output;
}
function canonicalValue(value, budget, depth = 0, seen = new WeakSet()) {
    if (budget.nodes <= 0 || budget.chars <= 0)
        return "[budget-limit]";
    budget.nodes--;
    const nonObject = canonicalNonObject(value, budget);
    if (nonObject.matched)
        return nonObject.value;
    if (depth >= MAX_FINGERPRINT_DEPTH)
        return "[depth-limit]";
    if (seen.has(value))
        return "[circular]";
    seen.add(value);
    return Array.isArray(value)
        ? canonicalArray(value, budget, depth, seen)
        : canonicalObject(value, budget, depth, seen);
}
function keyedDigest(domain, ...values) {
    const hmac = createHmac("sha256", PROCESS_FINGERPRINT_KEY).update(domain).update("\0");
    for (const value of values)
        hmac.update(value).update("\0");
    return hmac.digest("hex");
}
export function toolFingerprint(toolName, input) {
    const budget = { nodes: MAX_FINGERPRINT_NODES, chars: MAX_FINGERPRINT_CHARS };
    let canonical = "[unavailable]";
    try {
        canonical = JSON.stringify(canonicalValue(input, budget));
    }
    catch {
        // Hostile proxies and getters do not get to interrupt tracing.
    }
    return `${FINGERPRINT_PREFIX}${keyedDigest(FINGERPRINT_DOMAIN, toolName.slice(0, MAX_TOOL_NAME_CHARS), canonical)}`;
}
export function sanitizeFingerprint(value) {
    if (typeof value === "string" && /^h1:[a-f0-9]{64}$/u.test(value))
        return value;
    const opaque = typeof value === "string" ? value.slice(0, 256) : "invalid";
    return `${FINGERPRINT_PREFIX}${keyedDigest(LEGACY_FINGERPRINT_DOMAIN, opaque)}`;
}
