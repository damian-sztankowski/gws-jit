import { useState, useEffect } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';

export default function Documentation() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await fetch('/api/docs', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          setContent(data.content);
        } else {
          setContent('Failed to load system documentation.');
        }
      } catch (err) {
        setContent('Error communicating with server to fetch documentation.');
      } finally {
        setLoading(false);
      }
    };
    fetchDocs();
  }, []);

  if (loading) {
    return (
      <div className="panel-card" style={{ padding: '3rem', textAlign: 'center' }}>
        <Loader2 className="logo-icon spin-loader" size={24} style={{ margin: '0 auto' }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading system documentation...</p>
      </div>
    );
  }

  // Comprehensive Markdown Parser to HTML elements
  const renderMarkdown = (md: string) => {
    const lines = md.split('\n');
    const elements: JSX.Element[] = [];
    let i = 0;

    while (i < lines.length) {
      let line = lines[i];

      // Code block
      if (line.trim().startsWith('```')) {
        let codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        elements.push(
          <pre key={`code-${i}`} style={{
            background: 'rgba(15, 23, 42, 0.05)',
            border: '1px solid rgba(15, 23, 42, 0.08)',
            padding: '1rem',
            borderRadius: '8px',
            overflowX: 'auto',
            fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
            fontSize: '0.85rem',
            color: 'var(--text-main)',
            margin: '1rem 0',
            lineHeight: '1.4'
          }}>
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        i++;
        continue;
      }

      // Blockquotes (Group consecutive blockquotes)
      if (line.trim().startsWith('>')) {
        let blockquoteLines: string[] = [];
        let type: 'note' | 'tip' | 'important' | 'warning' | 'caution' | 'default' = 'default';
        
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          let content = lines[i].trim().slice(1).trim();
          
          // Detect callouts
          if (content.startsWith('[!NOTE]')) {
            type = 'note';
            content = content.slice(7).trim();
          } else if (content.startsWith('[!TIP]')) {
            type = 'tip';
            content = content.slice(6).trim();
          } else if (content.startsWith('[!IMPORTANT]')) {
            type = 'important';
            content = content.slice(12).trim();
          } else if (content.startsWith('[!WARNING]')) {
            type = 'warning';
            content = content.slice(10).trim();
          } else if (content.startsWith('[!CAUTION]')) {
            type = 'caution';
            content = content.slice(10).trim();
          }
          
          if (content || blockquoteLines.length > 0) {
            blockquoteLines.push(content);
          }
          i++;
        }

        // Styles for warning/note alert callouts
        let borderLeftColor = 'var(--primary)';
        let background = 'rgba(79, 70, 229, 0.03)';
        let titleColor = 'var(--primary)';
        let title = '';

        if (type === 'warning') {
          borderLeftColor = '#eab308'; // yellow
          background = 'rgba(234, 179, 8, 0.04)';
          titleColor = '#ca8a04';
          title = '⚠️ WARNING';
        } else if (type === 'caution') {
          borderLeftColor = '#ef4444'; // red
          background = 'rgba(239, 68, 68, 0.04)';
          titleColor = '#dc2626';
          title = '🚨 CAUTION';
        } else if (type === 'important') {
          borderLeftColor = '#ec4899'; // pink
          background = 'rgba(236, 72, 153, 0.04)';
          titleColor = '#db2777';
          title = '🔥 IMPORTANT';
        } else if (type === 'tip') {
          borderLeftColor = '#10b981'; // green
          background = 'rgba(16, 185, 129, 0.04)';
          titleColor = '#059669';
          title = '💡 TIP';
        } else if (type === 'note') {
          borderLeftColor = '#3b82f6'; // blue
          background = 'rgba(59, 130, 246, 0.04)';
          titleColor = '#2563eb';
          title = '📝 NOTE';
        }

        elements.push(
          <div key={`bq-${i}`} style={{
            borderLeft: `4px solid ${borderLeftColor}`,
            background,
            padding: '0.85rem 1.2rem',
            margin: '1.2rem 0',
            borderRadius: '0 8px 8px 0',
            color: 'var(--text-muted)',
            fontSize: '0.9rem',
            lineHeight: '1.6'
          }}>
            {title && (
              <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: '0.4rem', color: titleColor, letterSpacing: '0.05em' }}>
                {title}
              </div>
            )}
            {blockquoteLines.map((lineContent, lineIdx) => (
              <p key={lineIdx} style={{ margin: 0, marginTop: lineIdx > 0 ? '0.4rem' : 0 }}>
                {parseInline(lineContent)}
              </p>
            ))}
          </div>
        );
        continue;
      }

      // Group consecutive list items into a single ul
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        const listItems: string[] = [];
        while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
          listItems.push(lines[i].trim().slice(2));
          i++;
        }
        elements.push(
          <ul key={`list-${i}`} style={{ margin: '0.8rem 0', paddingLeft: '1.5rem', listStyleType: 'disc' }}>
            {listItems.map((item, itemIdx) => (
              <li key={itemIdx} style={{ marginBottom: '0.4rem', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                {parseInline(item)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      const trimmed = line.trim();

      // Headings
      if (trimmed.startsWith('# ')) {
        elements.push(<h1 key={`h1-${i}`} style={{ fontSize: '1.8rem', fontWeight: 800, margin: '1.8rem 0 0.8rem', color: 'var(--text-main)' }}>{trimmed.slice(2)}</h1>);
      } else if (trimmed.startsWith('## ')) {
        elements.push(<h2 key={`h2-${i}`} style={{ fontSize: '1.4rem', fontWeight: 700, margin: '1.5rem 0 0.6rem', color: 'var(--text-main)', borderBottom: '1px solid rgba(15, 23, 42, 0.06)', paddingBottom: '0.3rem' }}>{trimmed.slice(3)}</h2>);
      } else if (trimmed.startsWith('### ')) {
        elements.push(<h3 key={`h3-${i}`} style={{ fontSize: '1.15rem', fontWeight: 600, margin: '1.2rem 0 0.5rem', color: 'var(--text-main)' }}>{trimmed.slice(4)}</h3>);
      }
      // Horizontal Rules
      else if (trimmed === '---') {
        elements.push(<hr key={`hr-${i}`} style={{ border: 0, borderTop: '1px solid rgba(15, 23, 42, 0.08)', margin: '1.5rem 0' }} />);
      }
      // Empty lines
      else if (trimmed === '') {
        elements.push(<div key={`empty-${i}`} style={{ height: '0.5rem' }} />);
      }
      // Paragraphs
      else {
        elements.push(<p key={`p-${i}`} style={{ color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '0.85rem', fontSize: '0.9rem' }}>{parseInline(line)}</p>);
      }

      i++;
    }

    return elements;
  };

  // Inline formatting parser for bold (**), inline code (`), and links ([text](url))
  const parseInline = (text: string) => {
    const regex = /(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\))/g;
    const tokens = text.split(regex);
    
    return tokens.map((token, i) => {
      if (token.startsWith('**') && token.endsWith('**')) {
        return <strong key={i} style={{ color: 'var(--text-main)', fontWeight: 700 }}>{token.slice(2, -2)}</strong>;
      }
      if (token.startsWith('`') && token.endsWith('`')) {
        return <code key={i} style={{
          background: 'rgba(15, 23, 42, 0.04)',
          padding: '0.15rem 0.35rem',
          borderRadius: '4px',
          fontFamily: 'SFMono-Regular, Consolas, monospace',
          fontSize: '0.8rem',
          color: 'var(--primary)',
          border: '1px solid rgba(15, 23, 42, 0.05)'
        }}>{token.slice(1, -1)}</code>;
      }
      if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
        const midIdx = token.indexOf('](');
        const linkText = token.slice(1, midIdx);
        const url = token.slice(midIdx + 2, -1);
        return (
          <a key={i} href={url} target={url.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" style={{
            color: 'var(--primary)',
            textDecoration: 'underline',
            fontWeight: '500'
          }}>
            {linkText}
          </a>
        );
      }
      return token;
    });
  };

  return (
    <section className="panel-card" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <BookOpen className="logo-icon" size={18} />
        <h3>System Documentation & Setup Guide</h3>
      </div>
      <div className="panel-body" style={{ padding: '2rem', maxHeight: '72vh', overflowY: 'auto' }}>
        {renderMarkdown(content)}
      </div>
    </section>
  );
}
