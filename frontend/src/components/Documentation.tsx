import { useState, useEffect } from 'react';
import { Loader2, Search, Copy, Check } from 'lucide-react';
import { getAuthHeaders } from '../api.ts';

type DocTrack = 'architecture' | 'manual' | 'readme';

interface TocSection {
  id: string;
  index: string;
  title: string;
  lines: string[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function CodeFrame({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div className="code-frame">
      <div className="code-frame-bar">
        <span className="code-frame-lang">{language || 'TEXT'}</span>
        <button type="button" className="code-copy-btn" onClick={handleCopy}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'COPIED' : 'COPY'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function SystemTopologyDiagram() {
  return (
    <div className="arch-blueprint" style={{ margin: '0.75rem 0 1.25rem' }}>
      <div className="arch-blueprint-head">
        <span className="eyebrow" style={{ color: 'var(--ink-900)' }}>
          FIG 01 · ZERO-TRUST REFERENCE TOPOLOGY
        </span>
        <span className="text-mono text-muted" style={{ fontSize: '0.68rem' }}>
          IAP + CLOUD RUN + KEYLESS DWD
        </span>
      </div>

      <svg
        viewBox="0 0 820 230"
        width="100%"
        style={{ minWidth: '640px', display: 'block' }}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="GWS JIT Zero-Trust System Topology"
      >
        <defs>
          <marker
            id="arrowSlate"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#64748B" />
          </marker>
          <marker
            id="arrowCobalt"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#1D4ED8" />
          </marker>
        </defs>

        {/* Node 1: Operator */}
        <rect x="12" y="76" width="136" height="72" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
        <text x="26" y="99" fill="#64748B" fontFamily="JetBrains Mono, monospace" fontSize="9" fontWeight="600">
          PRINCIPAL
        </text>
        <text x="26" y="118" fill="#0F172A" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="12" fontWeight="700">
          Operator Console
        </text>
        <text x="26" y="134" fill="#64748B" fontFamily="Inter, sans-serif" fontSize="10">
          HTTPS + SSE Stream
        </text>

        {/* Connector 1 -> 2 */}
        <line x1="148" y1="112" x2="188" y2="112" stroke="#64748B" strokeWidth="1.4" markerEnd="url(#arrowSlate)" />

        {/* Node 2: Edge Perimeter */}
        <rect x="192" y="62" width="164" height="100" rx="6" fill="#FFFFFF" stroke="#93C5FD" />
        <rect x="192" y="62" width="164" height="22" rx="6" fill="#EFF6FF" />
        <text x="204" y="77" fill="#1E40AF" fontFamily="JetBrains Mono, monospace" fontSize="9" fontWeight="600">
          GCP EDGE PERIMETER
        </text>
        <text x="204" y="104" fill="#0F172A" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="12" fontWeight="700">
          Cloud Armor + IAP
        </text>
        <text x="204" y="121" fill="#475569" fontFamily="Inter, sans-serif" fontSize="10">
          OWASP WAF &amp; SSO Gate
        </text>
        <text x="204" y="142" fill="#1D4ED8" fontFamily="JetBrains Mono, monospace" fontSize="9">
          x-goog-iap-jwt
        </text>

        {/* Connector 2 -> 3 */}
        <line x1="356" y1="112" x2="398" y2="112" stroke="#1D4ED8" strokeWidth="1.5" markerEnd="url(#arrowCobalt)" />

        {/* Node 3: Cloud Run Control Plane */}
        <rect x="402" y="48" width="178" height="128" rx="6" fill="#0B1220" stroke="#1E293B" />
        <circle cx="418" cy="66" r="3.5" fill="#10B981" />
        <text x="428" y="69" fill="#94A3B8" fontFamily="JetBrains Mono, monospace" fontSize="9" fontWeight="600">
          CLOUD RUN SERVICE
        </text>
        <text x="416" y="94" fill="#FFFFFF" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="13" fontWeight="700">
          GWS JIT Engine
        </text>
        <text x="416" y="112" fill="#94A3B8" fontFamily="Inter, sans-serif" fontSize="10">
          ABAC · 2-Peer Quorum
        </text>
        <text x="416" y="128" fill="#94A3B8" fontFamily="Inter, sans-serif" fontSize="10">
          Break-Glass · Scheduler
        </text>
        <text x="416" y="152" fill="#60A5FA" fontFamily="JetBrains Mono, monospace" fontSize="9">
          /api/* · /healthz
        </text>

        {/* Connectors from Engine to Downstream Targets */}
        <path d="M 580 78 L 614 78 L 614 42 L 636 42" stroke="#64748B" strokeWidth="1.3" markerEnd="url(#arrowSlate)" />
        <line x1="580" y1="112" x2="636" y2="112" stroke="#1D4ED8" strokeWidth="1.5" markerEnd="url(#arrowCobalt)" />
        <path d="M 580 146 L 614 146 L 614 184 L 636 184" stroke="#64748B" strokeWidth="1.3" strokeDasharray="3 3" markerEnd="url(#arrowSlate)" />

        {/* Target A: Firestore */}
        <rect x="640" y="14" width="168" height="56" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
        <text x="652" y="33" fill="#64748B" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fontWeight="600">
          STATE &amp; LEDGER
        </text>
        <text x="652" y="51" fill="#0F172A" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="11.5" fontWeight="700">
          Cloud Firestore
        </text>

        {/* Target B: IAM Credentials + Workspace Directory */}
        <rect x="640" y="82" width="168" height="60" rx="6" fill="#ECFDF5" stroke="#A7F3D0" />
        <text x="652" y="101" fill="#065F46" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fontWeight="600">
          KEYLESS DWD (SIGNJWT)
        </text>
        <text x="652" y="119" fill="#064E3B" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="11.5" fontWeight="700">
          Workspace Directory
        </text>
        <text x="652" y="133" fill="#047857" fontFamily="JetBrains Mono, monospace" fontSize="8.5">
          members.insert / delete
        </text>

        {/* Target C: Pinned HTTPS Webhooks */}
        <rect x="640" y="156" width="168" height="56" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
        <text x="652" y="175" fill="#64748B" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fontWeight="600">
          DNS-PINNED EGRESS
        </text>
        <text x="652" y="193" fill="#0F172A" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="11.5" fontWeight="700">
          Chat / SIEM Webhooks
        </text>
      </svg>
    </div>
  );
}

function LeaseLifecycleDiagram() {
  return (
    <div className="arch-blueprint">
      <div className="arch-blueprint-head">
        <span className="eyebrow" style={{ color: 'var(--ink-900)' }}>
          FIG 02 · PRIVILEGE LEASE STATE MACHINE
        </span>
        <span className="text-mono text-muted" style={{ fontSize: '0.68rem' }}>
          TRANSACTIONAL REVOCATION LOOP
        </span>
      </div>

      <svg
        viewBox="0 0 820 148"
        width="100%"
        style={{ minWidth: '640px', display: 'block' }}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Privilege Lease Lifecycle State Machine"
      >
        <defs>
          <marker
            id="arrowStateSlate"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#64748B" />
          </marker>
          <marker
            id="arrowStateCobalt"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#1D4ED8" />
          </marker>
          <marker
            id="arrowStateCrimson"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#E11D48" />
          </marker>
        </defs>

        {/* Standard Path */}
        <rect x="14" y="24" width="142" height="46" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
        <text x="85" y="44" textAnchor="middle" fill="#0F172A" fontFamily="JetBrains Mono, monospace" fontSize="10" fontWeight="600">
          PENDING
        </text>
        <text x="85" y="58" textAnchor="middle" fill="#64748B" fontFamily="Inter, sans-serif" fontSize="9.5">
          ABAC Verified
        </text>

        <line x1="156" y1="47" x2="210" y2="47" stroke="#64748B" strokeWidth="1.3" markerEnd="url(#arrowStateSlate)" />

        <rect x="214" y="24" width="162" height="46" rx="5" fill="#FFFBEB" stroke="#FDE68A" />
        <text x="295" y="44" textAnchor="middle" fill="#92400E" fontFamily="JetBrains Mono, monospace" fontSize="10" fontWeight="600">
          QUORUM (1/1 or 2/2)
        </text>
        <text x="295" y="58" textAnchor="middle" fill="#B45309" fontFamily="Inter, sans-serif" fontSize="9.5">
          Peer Custody Check
        </text>

        <line x1="376" y1="47" x2="434" y2="47" stroke="#1D4ED8" strokeWidth="1.4" markerEnd="url(#arrowStateCobalt)" />

        <rect x="438" y="20" width="166" height="54" rx="5" fill="#ECFDF5" stroke="#A7F3D0" />
        <text x="521" y="42" textAnchor="middle" fill="#065F46" fontFamily="JetBrains Mono, monospace" fontSize="10.5" fontWeight="700">
          ACTIVE LEASE
        </text>
        <text x="521" y="58" textAnchor="middle" fill="#047857" fontFamily="JetBrains Mono, monospace" fontSize="9">
          +30m Extend (max 2x)
        </text>

        <line x1="604" y1="47" x2="658" y2="47" stroke="#64748B" strokeWidth="1.3" markerEnd="url(#arrowStateSlate)" />

        <rect x="662" y="24" width="144" height="46" rx="5" fill="#F8FAFC" stroke="#CBD5E1" />
        <text x="734" y="44" textAnchor="middle" fill="#334155" fontFamily="JetBrains Mono, monospace" fontSize="10" fontWeight="600">
          EXPIRED / REVOKED
        </text>
        <text x="734" y="58" textAnchor="middle" fill="#64748B" fontFamily="Inter, sans-serif" fontSize="9.5">
          Member Deleted
        </text>

        {/* P0 Break-Glass Fast Path */}
        <rect x="214" y="92" width="162" height="40" rx="5" fill="#FFF1F2" stroke="#FECDD3" />
        <text x="295" y="110" textAnchor="middle" fill="#9F1239" fontFamily="JetBrains Mono, monospace" fontSize="9.5" fontWeight="700">
          P0 BREAK-GLASS (30M)
        </text>
        <text x="295" y="123" textAnchor="middle" fill="#BE123C" fontFamily="Inter, sans-serif" fontSize="9">
          oncall + Mandatory Ticket
        </text>

        <path d="M 376 112 L 521 112 L 521 76" stroke="#E11D48" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#arrowStateCrimson)" />
      </svg>
    </div>
  );
}

export default function Documentation() {
  const [track, setTrack] = useState<DocTrack>('architecture');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeAnchor, setActiveAnchor] = useState<string>('');

  useEffect(() => {
    if (track === 'architecture') return;

    const fetchDocs = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/docs?type=${track}`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          setContent(data.content);
        } else {
          setContent('Failed to load documentation.');
        }
      } catch {
        setContent('Error communicating with server to fetch documentation.');
      } finally {
        setLoading(false);
      }
    };
    fetchDocs();
  }, [track]);

  const parseInline = (text: string) => {
    const regex = /(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\)|\*[^*\s][^*]*?\*)/g;
    const tokens = text.split(regex);

    return tokens.map((token, i) => {
      if (token.startsWith('**') && token.endsWith('**')) {
        return (
          <strong key={i} style={{ color: 'var(--ink-950)', fontWeight: 600 }}>
            {token.slice(2, -2)}
          </strong>
        );
      }
      if (token.startsWith('`') && token.endsWith('`')) {
        return (
          <code key={i} className="prose-inline-code">
            {token.slice(1, -1)}
          </code>
        );
      }
      if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
        const midIdx = token.indexOf('](');
        const linkText = token.slice(1, midIdx);
        const url = token.slice(midIdx + 2, -1).trim();
        const lowerUrl = url.toLowerCase();
        const isMalicious =
          lowerUrl.startsWith('javascript:') ||
          lowerUrl.startsWith('data:') ||
          lowerUrl.startsWith('vbscript:');
        const safeUrl = isMalicious ? '#' : url;
        return (
          <a
            key={i}
            href={safeUrl}
            target={safeUrl.startsWith('http') ? '_blank' : undefined}
            rel="noopener noreferrer"
          >
            {linkText}
          </a>
        );
      }
      if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
        return <em key={i}>{token.slice(1, -1)}</em>;
      }
      return token;
    });
  };

  const renderLines = (lines: string[], keyPrefix: string) => {
    const elements: JSX.Element[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Fenced Code Block
      if (trimmed.startsWith('```')) {
        const lang = trimmed.slice(3).trim().toLowerCase();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (lang === 'mermaid') {
          elements.push(<SystemTopologyDiagram key={`${keyPrefix}-mermaid-${i}`} />);
        } else {
          elements.push(
            <CodeFrame
              key={`${keyPrefix}-code-${i}`}
              language={lang || 'shell'}
              code={codeLines.join('\n')}
            />
          );
        }
        i++;
        continue;
      }

      // GFM Pipe Table
      if (
        trimmed.startsWith('|') &&
        i + 1 < lines.length &&
        /^\|\s*[:\-| ]+\|\s*$/.test(lines[i + 1].trim())
      ) {
        const parseCells = (rowStr: string) =>
          rowStr
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim());

        const headers = parseCells(lines[i]);
        i += 2; // Skip header & alignment row
        const bodyRows: string[][] = [];

        while (i < lines.length && lines[i].trim().startsWith('|')) {
          bodyRows.push(parseCells(lines[i]));
          i++;
        }

        elements.push(
          <div key={`${keyPrefix}-tbl-${i}`} className="prose-table-card">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {headers.map((h, hIdx) => (
                      <th key={hIdx}>{parseInline(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {headers.map((_, cIdx) => (
                        <td key={cIdx}>{parseInline(row[cIdx] || '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
        continue;
      }

      // Blockquote / Callout
      if (trimmed.startsWith('>')) {
        const blockquoteLines: string[] = [];
        let tone: 'default' | 'warn' | 'danger' = 'default';
        let label = 'NOTE';

        while (i < lines.length && lines[i].trim().startsWith('>')) {
          let raw = lines[i].trim().slice(1).trim();
          if (raw.startsWith('[!WARNING]')) {
            tone = 'warn';
            label = 'WARNING';
            raw = raw.slice(10).trim();
          } else if (raw.startsWith('[!CAUTION]')) {
            tone = 'danger';
            label = 'CRITICAL SECURITY';
            raw = raw.slice(10).trim();
          } else if (raw.startsWith('[!IMPORTANT]')) {
            tone = 'warn';
            label = 'SECURITY REQUIREMENT';
            raw = raw.slice(12).trim();
          } else if (raw.startsWith('[!TIP]')) {
            label = 'BEST PRACTICE';
            raw = raw.slice(6).trim();
          } else if (raw.startsWith('[!NOTE]')) {
            label = 'NOTE';
            raw = raw.slice(7).trim();
          }
          if (raw || blockquoteLines.length > 0) {
            blockquoteLines.push(raw);
          }
          i++;
        }

        const cls =
          tone === 'danger'
            ? 'docs-callout docs-callout--danger'
            : tone === 'warn'
              ? 'docs-callout docs-callout--warn'
              : 'docs-callout';

        elements.push(
          <div key={`${keyPrefix}-bq-${i}`} className={cls}>
            <span className="docs-callout-label">{label}</span>
            {blockquoteLines.map((lineContent, idx) => (
              <div key={idx}>{parseInline(lineContent)}</div>
            ))}
          </div>
        );
        continue;
      }

      // Unordered List (supports nested indented sub-bullets)
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const items: { text: string; subItems: string[] }[] = [];
        while (i < lines.length) {
          const rawLine = lines[i];
          const t = rawLine.trim();
          const indent = rawLine.search(/\S/);
          if (indent >= 2 && (t.startsWith('- ') || t.startsWith('* ')) && items.length > 0) {
            items[items.length - 1].subItems.push(t.slice(2));
            i++;
          } else if (t.startsWith('- ') || t.startsWith('* ')) {
            items.push({ text: t.slice(2), subItems: [] });
            i++;
          } else {
            break;
          }
        }
        elements.push(
          <ul key={`${keyPrefix}-ul-${i}`}>
            {items.map((item, idx) => (
              <li key={idx}>
                {parseInline(item.text)}
                {item.subItems.length > 0 && (
                  <ul>
                    {item.subItems.map((sub, sIdx) => (
                      <li key={sIdx}>{parseInline(sub)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Ordered List (`1. `, `2. `)
      if (/^\d+\.\s+/.test(trimmed)) {
        const items: { text: string; subItems: string[] }[] = [];
        while (i < lines.length) {
          const rawLine = lines[i];
          const t = rawLine.trim();
          const indent = rawLine.search(/\S/);
          if (indent >= 2 && (t.startsWith('- ') || t.startsWith('* ')) && items.length > 0) {
            items[items.length - 1].subItems.push(t.slice(2));
            i++;
          } else if (/^\d+\.\s+/.test(t)) {
            items.push({ text: t.replace(/^\d+\.\s+/, ''), subItems: [] });
            i++;
          } else {
            break;
          }
        }
        elements.push(
          <ol key={`${keyPrefix}-ol-${i}`}>
            {items.map((item, idx) => (
              <li key={idx}>
                {parseInline(item.text)}
                {item.subItems.length > 0 && (
                  <ul>
                    {item.subItems.map((sub, sIdx) => (
                      <li key={sIdx}>{parseInline(sub)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      if (trimmed.startsWith('# ')) {
        elements.push(<h1 key={`${keyPrefix}-h1-${i}`}>{trimmed.slice(2)}</h1>);
      } else if (trimmed.startsWith('### ')) {
        elements.push(<h3 key={`${keyPrefix}-h3-${i}`}>{trimmed.slice(4)}</h3>);
      } else if (trimmed.startsWith('#### ')) {
        elements.push(<h4 key={`${keyPrefix}-h4-${i}`}>{trimmed.slice(5)}</h4>);
      } else if (trimmed === '---') {
        // Section dividers handled structurally via prose-h2
      } else if (trimmed !== '') {
        elements.push(<p key={`${keyPrefix}-p-${i}`}>{parseInline(line)}</p>);
      }
      i++;
    }

    return elements;
  };

  // Split markdown into intro + indexed ## sections (omitting manual "Table of Contents")
  const buildSections = (md: string): { introLines: string[]; sections: TocSection[] } => {
    const allLines = md.split('\n');
    const introLines: string[] = [];
    const rawSections: { title: string; lines: string[] }[] = [];
    let current: { title: string; lines: string[] } | null = null;

    for (const line of allLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('## ')) {
        const title = trimmed.slice(3).trim();
        current = { title, lines: [] };
        rawSections.push(current);
      } else if (current) {
        current.lines.push(line);
      } else {
        introLines.push(line);
      }
    }

    const filteredRaw = rawSections.filter(
      (s) => s.title.toLowerCase() !== 'table of contents'
    );

    const sections: TocSection[] = filteredRaw.map((s, idx) => ({
      id: `doc-sec-${slugify(s.title)}-${idx}`,
      index: String(idx + 1).padStart(2, '0'),
      title: s.title,
      lines: s.lines
    }));

    return { introLines, sections };
  };

  const { introLines, sections } = buildSections(content);
  const queryLower = searchQuery.trim().toLowerCase();
  const visibleSections = queryLower
    ? sections.filter(
        (s) =>
          s.title.toLowerCase().includes(queryLower) ||
          s.lines.some((l) => l.toLowerCase().includes(queryLower))
      )
    : sections;

  const scrollToSection = (id: string) => {
    setActiveAnchor(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="docs-hub">
      {/* Top Track Switcher & Search Bar */}
      <div className="docs-toolbar">
        <div className="segmented" role="tablist" aria-label="Documentation track">
          <button
            type="button"
            className={`segmented-btn ${track === 'architecture' ? 'active' : ''}`}
            onClick={() => {
              setTrack('architecture');
              setSearchQuery('');
            }}
          >
            Architecture & Security
          </button>
          <button
            type="button"
            className={`segmented-btn ${track === 'manual' ? 'active' : ''}`}
            onClick={() => {
              setTrack('manual');
              setActiveAnchor('');
            }}
          >
            Operator Manual
          </button>
          <button
            type="button"
            className={`segmented-btn ${track === 'readme' ? 'active' : ''}`}
            onClick={() => {
              setTrack('readme');
              setActiveAnchor('');
            }}
          >
            Cloud Deployment
          </button>
        </div>

        {track !== 'architecture' && (
          <div className="input-wrap" style={{ maxWidth: '280px' }}>
            <Search size={14} className="input-icon" />
            <input
              type="text"
              className="input input--with-icon"
              style={{ height: '32px', fontSize: '0.79rem' }}
              placeholder="Filter sections or commands..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* TRACK 1: ARCHITECTURE & SECURITY BLUEPRINT */}
      {track === 'architecture' ? (
        <div className="stack-lg">
          <SystemTopologyDiagram />
          <LeaseLifecycleDiagram />

          <div>
            <div className="eyebrow" style={{ marginBottom: '0.6rem' }}>
              DEFENSE-IN-DEPTH CONTROLS
            </div>
            <div className="arch-spec-grid">
              <div className="arch-spec-card">
                <span className="text-mono" style={{ color: 'var(--cobalt-600)', fontWeight: 600 }}>
                  01 · IDENTITY &amp; SESSIONS
                </span>
                <h4 style={{ fontSize: '0.88rem' }}>Zero-Trust Authentication</h4>
                <p className="field-hint">
                  Verifies Google Cloud IAP signed ES256 JWTs against audience bounds in production, or enforces PBKDF2-SHA512 (210,000 iterations) with SHA-256 hashed session tokens and immediate revocation on role/password changes.
                </p>
              </div>

              <div className="arch-spec-card">
                <span className="text-mono" style={{ color: 'var(--cobalt-600)', fontWeight: 600 }}>
                  02 · KEYLESS DELEGATION
                </span>
                <h4 style={{ fontSize: '0.88rem' }}>Workload Identity DWD</h4>
                <p className="field-hint">
                  Eliminates static service account JSON keys via GCP IAM Credentials <code>signJwt</code>, caching short-lived OAuth2 tokens in memory and scoping impersonation to a custom Group-Operator role.
                </p>
              </div>

              <div className="arch-spec-card">
                <span className="text-mono" style={{ color: 'var(--cobalt-600)', fontWeight: 600 }}>
                  03 · EGRESS &amp; EXPIRY SAFETY
                </span>
                <h4 style={{ fontSize: '0.88rem' }}>SSRF Guard &amp; Atomic Expiry</h4>
                <p className="field-hint">
                  Webhook dispatchers resolve all DNS records, block RFC-1918 / CGNAT / metadata IPs, and pin outbound TLS sockets. Lease expiration claims are executed inside Firestore transactions.
                </p>
              </div>
            </div>
          </div>

          <div className="surface-card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Quick Evaluation Commands</h3>
                <p className="card-subtitle">Launch locally with hot-reload or deploy via Terraform IaC</p>
              </div>
            </div>
            <div className="card-body" style={{ paddingTop: '0.5rem' }}>
              <CodeFrame
                language="bash"
                code={`# Local sandbox mode (Frontend: :3000, API: :3001)
npm install && npm run dev

# Declarative GCP provisioning (Cloud Run + Firestore + Cloud Armor + Scheduler)
terraform init && terraform apply \\
  -var="project_id=YOUR_PROJECT_ID" \\
  -var="domain_name=jit.company.com" \\
  -var="container_image=us-central1-docker.pkg.dev/YOUR_PROJECT_ID/gws-jit-repo/gws-jit-portal:latest"`}
              />
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="empty-state">
          <Loader2 size={16} className="spin" />
          <span>Loading technical reference...</span>
        </div>
      ) : (
        /* TRACK 2 & 3: MARKDOWN + STICKY OUTLINE RAIL */
        <div className="docs-grid">
          <article className="docs-article prose">
            {!queryLower && introLines.length > 0 && renderLines(introLines, 'intro')}

            {visibleSections.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No matching sections</div>
                <span>No documentation sections matched "{searchQuery}".</span>
              </div>
            ) : (
              visibleSections.map((sec) => (
                <section key={sec.id} style={{ marginBottom: '1.5rem' }}>
                  <h2 id={sec.id} className="prose-h2">
                    <span className="prose-h2-idx">{sec.index}</span>
                    <span>{sec.title}</span>
                  </h2>
                  {renderLines(sec.lines, sec.id)}
                </section>
              ))
            )}
          </article>

          {visibleSections.length > 0 && (
            <aside className="docs-toc" aria-label="On this page">
              <div className="docs-toc-title">On this page</div>
              {visibleSections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={`docs-toc-link ${
                    (activeAnchor || visibleSections[0]?.id) === sec.id ? 'active' : ''
                  }`}
                  onClick={() => scrollToSection(sec.id)}
                >
                  <span className="docs-toc-idx">{sec.index}</span>
                  <span>{sec.title}</span>
                </button>
              ))}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
