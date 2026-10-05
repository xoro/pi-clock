// @ts-nocheck -- standalone extension file, not part of a tsconfig project; pi resolves these packages at runtime
// Replaces the footer with a close copy of pi's default footer, plus the clock
// right-aligned on the extension-status line (same line as other extensions).
//
// ponytail: this duplicates pi's internal footer formatting (not a public API,
// so it can drift from pi's real footer on upgrades) instead of a few lines of
// config. It also drops two edge-case decorations the stock footer has:
// the "(sub)" subscription-cost marker and the "→ routed-model" virtual-model
// arrow. Upgrade path: drop this file and go back to a visually separate
// clock line (ctx.ui.setWidget) if footer drift or missing decorations bite.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { relative, join } from "node:path";
import { readFileSync } from "node:fs";

const CONFIG_PATH = join(process.env.HOME ?? "", ".pi/agent/clock-status.json");
const DEFAULT_FORMAT = "EEE DD.MM.YYYY HH:mm:ss";

/**
 * ~/.pi/agent/clock-status.json (plain JSON, no comments):
 * {
 *   "format": "EEE DD.MM.YYYY HH:mm:ss",
 *   "timeZone": null,
 *   "position": "right"
 * }
 *
 * format tokens: YYYY (year) MM (month) DD (day) HH (24h hour) hh (12h hour)
 *   mm (minute) ss (second) EEE (short weekday, e.g. "Sun") a (am/pm)
 *   Other characters (spaces, dots, slashes, dashes, colons) pass through as-is.
 *   Example: "MM/DD/YYYY hh:mm:ss a" -> "10/04/2026 03:41:22 pm"
 *
 * timeZone: IANA name, e.g. "Europe/Berlin" or "America/New_York".
 *   null, omitted, or invalid = system's local time zone.
 *
 * position: "right" (default) or "left" of the extension-status line.
 *
 * Missing file or malformed JSON falls back to the defaults below.
 */

// Supported tokens: YYYY MM DD HH (24h) hh (12h) mm ss EEE (short weekday) a (am/pm)
function formatNow(pattern: string, timeZone: string | undefined): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		weekday: "short",
	});
	const parts = Object.fromEntries(dtf.formatToParts(d).map((part) => [part.type, part.value]));
	const hours24 = Number(parts.hour) % 24; // h23 reports midnight as "24" in some ICU builds
	const hours12 = hours24 % 12 || 12;
	const tokens: Record<string, string> = {
		YYYY: parts.year,
		MM: parts.month,
		DD: parts.day,
		HH: p(hours24),
		hh: p(hours12),
		mm: parts.minute,
		ss: parts.second,
		EEE: parts.weekday,
		a: hours24 < 12 ? "am" : "pm",
	};
	return pattern.replace(/YYYY|MM|DD|HH|hh|mm|ss|EEE|a/g, (m) => tokens[m]);
}

function loadConfig(): { format: string; timeZone: string | undefined; position: "left" | "right" } {
	try {
		const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		return {
			format: typeof config.format === "string" ? config.format : DEFAULT_FORMAT,
			timeZone: typeof config.timeZone === "string" ? config.timeZone : undefined,
			position: config.position === "left" ? "left" : "right",
		};
	} catch {
		return { format: DEFAULT_FORMAT, timeZone: undefined, position: "right" };
	}
}

const CLOCK_KEY = "zz-clock";

function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1000000).toFixed(1)}M`;
}

function formatCwd(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const rel = relative(home, cwd);
	if (rel === "") return "~";
	if (rel.startsWith("..")) return cwd;
	return `~/${rel}`;
}


export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			const timer = setInterval(() => tui.requestRender(), 1000);
			timer.unref();

			return {
				dispose: () => {
					unsub();
					clearInterval(timer);
				},
				invalidate() {},
				render(width: number): string[] {
					// Line 1: pwd + git branch + session name
					let pwd = formatCwd(ctx.sessionManager.getCwd(), process.env.HOME);
					const branch = footerData.getGitBranch();
					if (branch) pwd += ` (${branch})`;
					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) pwd += ` • ${sessionName}`;
					const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

					// Line 2: token/cost/context stats + model name
					let input = 0,
						output = 0,
						cacheRead = 0,
						cacheWrite = 0,
						cost = 0;
					for (const e of ctx.sessionManager.getEntries()) {
						const usage =
							e.type === "usage"
								? e.usage
								: e.type === "message" && (e.message.role === "assistant" || (e.message.role === "toolResult" && e.message.usage))
									? (e.message as any).usage
									: (e.type === "branch_summary" || e.type === "compaction") && (e as any).usage
										? (e as any).usage
										: undefined;
						if (!usage) continue;
						input += usage.input ?? 0;
						output += usage.output ?? 0;
						cacheRead += usage.cacheRead ?? 0;
						cacheWrite += usage.cacheWrite ?? 0;
						cost += usage.cost?.total ?? 0;
					}
					const statsParts: string[] = [];
					if (input) statsParts.push(`↑${formatTokens(input)}`);
					if (output) statsParts.push(`↓${formatTokens(output)}`);
					if (cacheRead) statsParts.push(`R${formatTokens(cacheRead)}`);
					if (cacheWrite) statsParts.push(`W${formatTokens(cacheWrite)}`);
					if (cost) statsParts.push(`$${cost.toFixed(3)}`);
					const usage = ctx.getContextUsage();
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextPct = usage?.percent != null ? `${usage.percent.toFixed(1)}%` : "?";
					statsParts.push(`${contextPct}/${formatTokens(contextWindow)}`);
					const statsLeft = statsParts.join(" ");
					const modelName = ctx.model?.id ?? "no-model";
					const rightSide = ctx.model?.reasoning
						? `${modelName} • ${ctx.thinkingLevel ?? "off"}`
						: modelName;
					const pad = Math.max(1, width - visibleWidth(statsLeft) - visibleWidth(rightSide));
					const statsLine = theme.fg("dim", truncateToWidth(statsLeft + " ".repeat(pad) + rightSide, width));

					// Line 3: other extensions' status text + right-aligned clock
					const others = Array.from(footerData.getExtensionStatuses().entries())
						.filter(([key]) => key !== CLOCK_KEY)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim());
					const left = others.join(" ");
					const clockConfig = loadConfig();
					const clock = theme.fg("dim", formatNow(clockConfig.format, clockConfig.timeZone));
					const gapPad = Math.max(1, width - visibleWidth(left) - (left ? 1 : 0) - visibleWidth(clock));
					const gap = " ".repeat(gapPad);
					const statusLine =
						clockConfig.position === "left"
							? truncateToWidth(clock + gap + left, width)
							: truncateToWidth(left + (left ? " " : "") + gap + clock, width);

					return [pwdLine, statsLine, statusLine];
				},
			};
		});
	});
}
