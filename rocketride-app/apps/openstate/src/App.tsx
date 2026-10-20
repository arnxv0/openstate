// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * OPENSTATE on RocketRide — the shared-spatial-memory frontend rendered by the
 * RocketRide shell. Every view reads the OPENSTATE backend (the Next.js API)
 * over HTTP; the backend URL is the one app setting.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
	AppLayout,
	Button,
	Card,
	ContentHeader,
	EmptyState,
	InputField,
	MessageList,
	NavButton,
	StatusBadge,
	usePolling,
	useSidebarCollapsed,
	useWorkspace,
	BxCog,
	BxDesktop,
	BxGridAlt,
	BxHome,
	BxListUl,
	BxUser,
	type ChatMessage,
} from 'shell';

// =============================================================================
// BACKEND TYPES (mirrors app/api/* of the OPENSTATE repo)
// =============================================================================

type Item = { name: string; count: number; since?: string; by?: string };
type Site = { name: string; place: string | null; items: Item[]; lastSeen?: string; lastObserver?: string; lastChange?: { summary: string; by?: string } | null };
type Change = { id: string; at: string; kind: string; item: string; who: string | null; detail?: string; summary: string };
type Trend = { item: string; site: string; inStock: number | null; used: number; tracked: string; perDay: number | null; runsOutIn: string | null; buy: string };
type Shopping = { item: string; site: string; reason: string };
type State = { sites: Site[]; changes: Change[]; trends: Trend[]; shoppingList: Shopping[] };

type Agent = { key: string; name: string; title: string; brief: string; color: string; tools: string[] };
type Avatar = { key: string; name: string; avatarId: string | null; imageUrl: string | null; liveUrl: string | null };
type Line = { id: string; requestId: string; from: string; to: string; text: string; at: string; tools?: string[]; ms?: number };
type Company = { roster: Agent[]; avatars: Avatar[]; band: { configured: boolean; roomId?: string; participants?: number }; transcript: Line[] };

type Ask = { answer?: string; company?: { agents?: string[]; transcript?: Line[] }; latencyMs?: number; error?: string };

const SETTING_URL = 'rocketride.openstate.backendUrl';
const DEFAULT_URL = 'http://localhost:3000';

// =============================================================================
// STYLES
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
	wrap: { padding: '18px 22px', fontFamily: 'var(--rr-font-family, system-ui)', color: 'var(--rr-text-primary)' },
	grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginTop: 14 },
	chip: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--rr-border)', fontSize: 12, marginRight: 6, marginBottom: 6 },
	muted: { fontSize: 12, color: 'var(--rr-text-secondary)' },
	mono: { fontFamily: 'var(--rr-font-mono, monospace)', fontSize: 12 },
	row: { display: 'flex', alignItems: 'center', gap: 10 },
	avatar: { width: 40, height: 40, borderRadius: 20, objectFit: 'cover', background: 'var(--rr-bg-paper)' },
	line: { padding: '8px 0', borderBottom: '1px solid var(--rr-border)', fontSize: 13 },
	nav: { padding: '8px 4px' },
	frame: { width: '100%', height: 'calc(100vh - 140px)', border: '1px solid var(--rr-border)', borderRadius: 8, background: '#000' },
	tile: { width: '100%', aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 8, background: '#000', display: 'block' },
	askWrap: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 150px)' },
	askInput: { display: 'flex', gap: 8, padding: '10px 0' },
};

// =============================================================================
// DATA
// =============================================================================

const FALLBACK_URLS = ['http://localhost:3000', 'http://localhost:3001'];

/**
 * Backend base URL: the app setting, or the first local candidate whose
 * /api/health answers (the Next.js dev server is on 3000 or 3001).
 */
function useBackend(): { base: string; ready: boolean } {
	const { settings } = useWorkspace();
	const configured = ((settings?.[SETTING_URL] as string | undefined) || DEFAULT_URL).replace(/\/$/, '');
	const [resolved, setResolved] = useState(configured);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		let alive = true;
		setReady(false);
		const candidates = [configured, ...FALLBACK_URLS.filter((url) => url !== configured)];
		(async () => {
			for (const url of candidates) {
				try {
					const response = await fetch(`${url}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
					if (response.ok) {
						if (alive) {
							setResolved(url);
							setReady(true);
						}
						return;
					}
				} catch {
					/* try the next candidate */
				}
			}
			if (alive) {
				setResolved(configured);
				setReady(true);
			}
		})();
		return () => {
			alive = false;
		};
	}, [configured]);
	return { base: resolved, ready };
}

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { cache: 'no-store' });
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
	return (await response.json()) as T;
}

const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// =============================================================================
// VIEWS
// =============================================================================

const Overview: React.FC<{ base: string }> = ({ base }) => {
	const [state, setState] = useState<State | null>(null);
	const [error, setError] = useState<string | null>(null);
	usePolling(async () => {
		try {
			setState(await getJson<State>(`${base}/api/state`));
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, 4000, { gate: 'none' });

	if (error) return <EmptyState title="Backend unreachable" description={`${base}/api/state — ${error}. Set the backend URL in Settings.`} />;
	if (!state) return <EmptyState title="Loading" description="Reading the world state." />;
	return (
		<>
			<div style={styles.grid}>
				{state.sites.map((site) => (
					<Card key={site.name} header={site.name} headerActions={<span style={styles.muted}>{site.lastSeen ? `seen ${site.lastSeen}` : ''}</span>}>
						{site.items.length === 0 && <span style={styles.muted}>Empty</span>}
						{site.items.map((item) => (
							<span key={item.name} style={styles.chip}>
								{item.name} ×{item.count}
							</span>
						))}
						{site.lastChange && <div style={styles.muted}>{site.lastChange.summary}</div>}
					</Card>
				))}
			</div>
			<div style={styles.grid}>
				<Card header="Recent changes">
					{state.changes.slice(0, 12).map((change) => (
						<div key={change.id} style={styles.line}>
							<span style={styles.mono}>{change.at}</span> · {change.summary}
						</div>
					))}
				</Card>
				<Card header="Trends">
					{state.trends.map((trend) => (
						<div key={`${trend.site}-${trend.item}`} style={styles.line}>
							<strong>{trend.item}</strong> at {trend.site}: {trend.inStock ?? 0} left, {(trend.perDay ?? 0).toFixed(1)} a day{' '}
							<StatusBadge variant={trend.buy === 'out' ? 'error' : trend.buy === 'soon' ? 'warning' : 'success'}>{trend.buy}</StatusBadge>
						</div>
					))}
				</Card>
				<Card header="Shopping list">
					{state.shoppingList.length === 0 && <span style={styles.muted}>Nothing to buy.</span>}
					{state.shoppingList.map((entry) => (
						<div key={`${entry.site}-${entry.item}`} style={styles.line}>
							{entry.item} <span style={styles.muted}>({entry.site}, {entry.reason})</span>
						</div>
					))}
				</Card>
			</div>
		</>
	);
};

const CompanyView: React.FC<{ base: string }> = ({ base }) => {
	const [company, setCompany] = useState<Company | null>(null);
	usePolling(async () => {
		try {
			setCompany(await getJson<Company>(`${base}/api/company`));
		} catch {
			/* the Overview reports the backend error */
		}
	}, 4000, { gate: 'none' });
	if (!company) return <EmptyState title="Loading" description="Reading the roster and the transcript." />;
	const byKey = Object.fromEntries(company.roster.map((agent) => [agent.key, agent]));
	const avatar = (key: string) => company.avatars.find((entry) => entry.key === key)?.imageUrl;
	return (
		<>
			<div style={styles.grid}>
				{company.roster.map((agent) => (
					<Card key={agent.key} header={<div style={styles.row}>{avatar(agent.key) ? <img style={styles.avatar} src={avatar(agent.key)!} alt={agent.name} /> : <BxUser />}<span>{agent.name}</span></div>}>
						<div style={{ color: agent.color, fontWeight: 600 }}>{agent.title}</div>
						<div style={styles.muted}>{agent.brief}</div>
						{agent.tools.length > 0 && <div style={{ ...styles.mono, marginTop: 6 }}>{agent.tools.join(' · ')}</div>}
					</Card>
				))}
			</div>
			<Card
				header="Transcript"
				headerActions={company.band.configured ? <StatusBadge variant="success">BAND room · {company.band.participants ?? 0}</StatusBadge> : <StatusBadge variant="muted">BAND off</StatusBadge>}
			>
				{company.transcript.length === 0 && <span style={styles.muted}>Nothing said yet. Ask something.</span>}
				{company.transcript.slice(-30).reverse().map((line) => (
					<div key={line.id} style={styles.line}>
						<strong style={{ color: byKey[line.from]?.color }}>{byKey[line.from]?.name ?? line.from}</strong>
						<span style={styles.muted}> → {byKey[line.to]?.name ?? line.to}</span>
						{line.ms ? <span style={styles.muted}> · {(line.ms / 1000).toFixed(1)}s</span> : null}
						<div>{line.text}</div>
					</div>
				))}
			</Card>
		</>
	);
};

const AskView: React.FC<{ base: string }> = ({ base }) => {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [text, setText] = useState('');
	const [busy, setBusy] = useState(false);
	const nextId = useRef(1);
	const push = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
		setMessages((prev) => [...prev, { ...message, id: nextId.current++, timestamp: stamp() }]);
	}, []);

	const send = useCallback(async () => {
		const question = text.trim();
		if (!question || busy) return;
		setText('');
		push({ text: question, sender: 'user' });
		setBusy(true);
		try {
			const response = await fetch(`${base}/api/ask`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: question, observerId: '02' }),
			});
			const data = (await response.json()) as Ask;
			if (!response.ok || data.error) throw new Error(data.error ?? `${response.status}`);
			for (const line of data.company?.transcript ?? []) {
				if (line.from !== 'host') push({ text: `**${line.from} → ${line.to}:** ${line.text}`, sender: 'status', sseType: 'agent' });
			}
			push({ text: data.answer ?? '(no answer)', sender: 'bot', meta: data.latencyMs ? `${(data.latencyMs / 1000).toFixed(1)}s · ${(data.company?.agents ?? []).join(', ')}` : undefined });
		} catch (cause) {
			push({ text: cause instanceof Error ? cause.message : String(cause), sender: 'bot', isError: true });
		} finally {
			setBusy(false);
		}
	}, [base, busy, push, text]);

	return (
		<div style={styles.askWrap}>
			<MessageList messages={messages} isTyping={busy} emptyTitle="Hey World" emptyDescription='Ask the company: "should I buy some Pepsi?"' />
			<div style={styles.askInput}>
				<InputField
					placeholder="Ask about any place the glasses have seen…"
					value={text}
					disabled={busy}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') void send();
					}}
					style={{ flex: 1 }}
				/>
				<Button onClick={() => void send()} disabled={busy || !text.trim()}>
					Ask
				</Button>
			</div>
		</div>
	);
};

/** One observer tile: long-polls the relay for the next JPEG and shows it. */
const ObserverTile: React.FC<{ base: string; id: string; label: string }> = ({ base, id, label }) => {
	const [src, setSrc] = useState<string | null>(null);
	const seq = useRef(0);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		const loop = async () => {
			while (alive.current) {
				try {
					const response = await fetch(`${base}/api/frame/${id}?after=${seq.current}`, { cache: 'no-store' });
					if (response.status === 200) {
						seq.current = Number(response.headers.get('X-Frame-Seq')) || seq.current + 1;
						const blob = await response.blob();
						setSrc((previous) => {
							if (previous) URL.revokeObjectURL(previous);
							return URL.createObjectURL(blob);
						});
					} else {
						await new Promise((resolve) => setTimeout(resolve, 1000));
					}
				} catch {
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			}
		};
		void loop();
		return () => {
			alive.current = false;
		};
	}, [base, id]);
	return (
		<Card header={label} headerActions={<StatusBadge variant={src ? 'success' : 'muted'}>{src ? 'LIVE' : 'waiting'}</StatusBadge>} noBodyPadding>
			{src ? <img style={styles.tile} src={src} alt={label} /> : <div style={{ ...styles.tile, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--rr-text-secondary)' }}>No frames yet</div>}
		</Card>
	);
};

const ObserversView: React.FC<{ base: string }> = ({ base }) => (
	<div style={{ ...styles.grid, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
		<ObserverTile base={base} id="01" label="Thilak · Observer 01" />
		<ObserverTile base={base} id="02" label="Arnav · Observer 02" />
	</div>
);

const LiveView: React.FC<{ base: string }> = ({ base }) => <iframe style={styles.frame} src={base} title="OPENSTATE dashboard" allow="camera; microphone" />;

// =============================================================================
// ROOT
// =============================================================================

type ViewId = 'overview' | 'company' | 'ask' | 'observers' | 'live';

const VIEWS: { id: ViewId; label: string; icon: typeof BxHome; title: string; subtitle: string }[] = [
	{ id: 'overview', label: 'Overview', icon: BxHome, title: 'World state', subtitle: 'Every place the glasses have seen, what is there now, and what is running out.' },
	{ id: 'company', label: 'Company', icon: BxGridAlt, title: 'The company', subtitle: 'Six agents with Masky faces; every hand-off is mirrored to the BAND room.' },
	{ id: 'ask', label: 'Ask', icon: BxListUl, title: 'Hey World', subtitle: 'Ask a question; Mira delegates, the specialists work, Sol answers.' },
	{ id: 'observers', label: 'Observers', icon: BxUser, title: 'Observers', subtitle: 'Live frames from each pair of glasses, over the relay.' },
	{ id: 'live', label: 'Live dashboard', icon: BxDesktop, title: 'Live dashboard', subtitle: 'The full OPENSTATE dashboard, embedded.' },
];

const SidebarNav: React.FC<{ active: ViewId; onPick: (id: ViewId) => void }> = ({ active, onPick }) => {
	const collapsed = useSidebarCollapsed();
	return (
		<div style={styles.nav}>
			{VIEWS.map((view) => (
				<NavButton key={view.id} icon={view.icon} label={view.label} isActive={active === view.id} collapsed={collapsed} onClick={() => onPick(view.id)} />
			))}
		</div>
	);
};

const App: React.FC = () => {
	const { prefs, updatePrefs } = useWorkspace();
	const { base, ready } = useBackend();
	const active = ((prefs as { view?: ViewId } | undefined)?.view ?? 'overview') as ViewId;
	const pick = (view: ViewId) => updatePrefs({ view } as Record<string, unknown>);
	const view = VIEWS.find((entry) => entry.id === active) ?? VIEWS[0];
	return (
		<AppLayout sidebar={<SidebarNav active={view.id} onPick={pick} />} status={<span style={styles.mono}>backend {base}</span>}>
			<div style={styles.wrap}>
				<ContentHeader title={view.title} subtitle={view.subtitle} actions={<span style={styles.row}><BxCog /> <span style={styles.muted}>Settings → Backend URL</span></span>} />
				<div style={{ ...styles.row, marginBottom: 14, flexWrap: 'wrap' }}>
					{VIEWS.map((entry) => (
						<Button key={entry.id} small variant={entry.id === view.id ? 'primary' : 'secondary'} onClick={() => pick(entry.id)}>
							{entry.label}
						</Button>
					))}
				</div>
				{!ready && <EmptyState title="Finding the backend" description="Checking the OPENSTATE API on the configured URL and the local dev ports." />}
				{ready && view.id === 'overview' && <Overview key={base} base={base} />}
				{ready && view.id === 'company' && <CompanyView key={base} base={base} />}
				{ready && view.id === 'ask' && <AskView key={base} base={base} />}
				{ready && view.id === 'observers' && <ObserversView key={base} base={base} />}
				{ready && view.id === 'live' && <LiveView key={base} base={base} />}
			</div>
		</AppLayout>
	);
};

export default App;
