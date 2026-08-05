import { eligibleFindingAggregates } from "./guidance.js";
import { compareText } from "./order.js";
import { guidanceFor, normalizeFindingCode, normalizeGuidanceId, normalizeToolName } from "./policy.js";
function formatDuration(ms) {
    if (ms < 1_000)
        return `${Math.round(ms)}ms`;
    if (ms < 10_000)
        return `${(ms / 1_000).toFixed(1)}s`;
    const totalSeconds = Math.round(ms / 1_000);
    if (totalSeconds < 60)
        return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
function percentage(part, total) {
    return total > 0 ? `${Math.round((part / total) * 100)}%` : "0%";
}
export function formatTraceAnalysis(analysis, title = "Tooltime report") {
    if (analysis.taskCount === 0)
        return `${title}\nNo task traces.`;
    const lines = [
        title,
        `tasks: ${analysis.taskCount}`,
        `task wall: ${formatDuration(analysis.taskWallMs)}`,
        `tool wall: ${formatDuration(analysis.toolWallMs)} (${percentage(analysis.toolWallMs, analysis.taskWallMs)} of task wall)`,
        `tool call sum: ${formatDuration(analysis.toolCallMs)}`,
        `calls: ${analysis.callCount} (${analysis.failureCount} failed)`,
        `suspected avoidable wall: ${formatDuration(analysis.suspectedWasteMs)}`,
    ];
    const tools = analysis.tools.slice(0, 5).map((tool) => ({ ...tool, toolName: normalizeToolName(tool.toolName) }));
    if (tools.length > 0) {
        lines.push("", "Top tools:");
        for (const tool of tools) {
            lines.push(`- ${tool.toolName}: ${formatDuration(tool.callMs)} across ${tool.callCount} call${tool.callCount === 1 ? "" : "s"}${tool.failureCount ? `, ${tool.failureCount} failed` : ""}`);
        }
    }
    const findings = analysis.findings.flatMap((finding) => {
        const code = normalizeFindingCode(finding.code);
        return code ? [{ ...finding, code }] : [];
    }).slice(0, 5);
    if (findings.length > 0) {
        lines.push("", "Efficiency findings:");
        for (const finding of findings) {
            lines.push(`- ${finding.code} (${finding.confidence}): ${finding.taskCount} task${finding.taskCount === 1 ? "" : "s"}, ${formatDuration(finding.totalWasteMs)} suspected`);
        }
    }
    if (analysis.modes.length > 1) {
        lines.push("", "By mode:");
        for (const mode of analysis.modes) {
            lines.push(`- ${mode.mode}: ${mode.taskCount} tasks, ${percentage(mode.toolWallMs, mode.taskWallMs)} tool wall, ${formatDuration(mode.suspectedWasteMs)} suspected`);
        }
    }
    return lines.join("\n");
}
const MODEL_TOOL_NAMES = new Set(["read", "grep", "find", "edit", "write", "bash", "tooltime_report"]);
function modelToolLabel(value) {
    const name = normalizeToolName(value);
    if (MODEL_TOOL_NAMES.has(name))
        return name;
    if (name.startsWith("fallow_"))
        return "repository";
    if (name.startsWith("browser_") || name.startsWith("research_"))
        return "web";
    if (name.startsWith("supabase_") || name.startsWith("posthog_") || /^(?:database|postgres|sql)_/u.test(name))
        return "database";
    if (name.startsWith("linear_"))
        return "issues";
    if (name.startsWith("whiskd_"))
        return "process";
    return "other";
}
function modelTools(tools) {
    const groups = new Map();
    for (const tool of tools) {
        const toolName = modelToolLabel(tool.toolName);
        const group = groups.get(toolName) ?? { toolName, callCount: 0, failureCount: 0, callMs: 0 };
        group.callCount += tool.callCount;
        group.failureCount += tool.failureCount;
        group.callMs += tool.callMs;
        groups.set(toolName, group);
    }
    return [...groups.values()].sort((a, b) => b.callMs - a.callMs || b.callCount - a.callCount || compareText(a.toolName, b.toolName));
}
export function formatTraceAnalysisForModel(analysis, title = "Tooltime report") {
    const safeTitle = /^Tooltime report(?: · (?:session|project|\d{1,4}d))?$/u.test(title) ? title : "Tooltime report";
    const findings = analysis.findings.filter((finding) => normalizeFindingCode(finding.code) !== undefined
        && (finding.confidence === "high" || finding.confidence === "medium"));
    const modes = analysis.modes.filter((mode) => ["off", "analytics", "coach"].includes(mode.mode));
    return formatTraceAnalysis({ ...analysis, tools: modelTools(analysis.tools), findings, modes }, safeTitle);
}
function candidateLine(finding, active) {
    return `- ${active ? "active" : "candidate"} ${finding.code} (${finding.confidence}): ${finding.taskCount} tasks, ${formatDuration(finding.totalWasteMs)} suspected\n  ${guidanceFor(finding.guidanceId)}`;
}
export function formatFindingCandidates(analysis, options) {
    const findings = analysis.findings.flatMap((finding) => {
        const code = normalizeFindingCode(finding.code);
        const guidanceId = normalizeGuidanceId(finding.guidanceId);
        return code && guidanceId ? [{ ...finding, code, signature: code, guidanceId, guidance: guidanceFor(guidanceId) }] : [];
    });
    if (findings.length === 0)
        return "Tooltime findings\nNo efficiency findings.";
    const active = new Set(eligibleFindingAggregates(findings, options).map((finding) => finding.signature));
    return [
        "Tooltime findings",
        ...findings.slice(0, 20).map((finding) => candidateLine(finding, finding.confidence === "high" && active.has(finding.signature))),
    ].join("\n");
}
