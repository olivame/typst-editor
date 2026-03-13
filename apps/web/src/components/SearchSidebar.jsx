import { useEffect, useState } from 'react'
import {
  APP_SIDEBAR_BACKGROUND,
  APP_SIDEBAR_BORDER,
  APP_SIDEBAR_WIDTH,
} from '../config/sidebar'

export default function SearchSidebar({ onClose, onOpenResult, onSearch }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isCancelled = false

    if (!query.trim()) {
      setResults([])
      setIsSearching(false)
      setErrorMessage('')
      return undefined
    }

    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true)
      setErrorMessage('')

      try {
        const nextResults = await onSearch(query.trim())
        if (!isCancelled) {
          setResults(nextResults)
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(error.message || 'Search failed')
          setResults([])
        }
      } finally {
        if (!isCancelled) {
          setIsSearching(false)
        }
      }
    }, 180)

    return () => {
      isCancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [onSearch, query])

  return (
    <aside style={styles.sidebar}>
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <button onClick={onClose} style={styles.iconButton}>←</button>
          <div style={styles.title}>Search</div>
          <button onClick={onClose} style={styles.iconButton}>×</button>
        </div>
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search all project files"
          style={styles.searchInput}
          value={query}
        />
      </div>

      <div style={styles.body}>
        {!query.trim() ? (
          <div style={styles.stateText}>Enter a keyword to search all text files in this project.</div>
        ) : null}
        {isSearching ? <div style={styles.stateText}>Searching…</div> : null}
        {errorMessage ? <div style={styles.errorText}>{errorMessage}</div> : null}
        {!isSearching && query.trim() && !errorMessage && results.length === 0 ? (
          <div style={styles.stateText}>No matches found.</div>
        ) : null}

        {results.map((result) => (
          <button
            key={`${result.file_id}-${result.line_number}-${result.start}`}
            onClick={() => onOpenResult(result)}
            style={styles.resultItem}
          >
            <div style={styles.resultPath}>{result.path}</div>
            <div style={styles.resultLine}>Line {result.line_number}</div>
            <div style={styles.resultSnippet}>{result.line}</div>
          </button>
        ))}
      </div>
    </aside>
  )
}

const styles = {
  sidebar: {
    width: APP_SIDEBAR_WIDTH,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: APP_SIDEBAR_BACKGROUND,
    color: '#334155',
    borderRight: `1px solid ${APP_SIDEBAR_BORDER}`,
    flexShrink: 0,
  },
  header: {
    padding: '12px 10px',
    borderBottom: '1px solid #d8dde6',
  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '12px',
  },
  iconButton: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  },
  title: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#1f2937',
  },
  searchInput: {
    width: '100%',
    height: '40px',
    padding: '0 12px',
    borderRadius: '10px',
    border: '1px solid #cfd6df',
    background: '#ffffff',
    color: '#1f2937',
    outline: 'none',
    fontSize: '13px',
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  stateText: {
    padding: '12px',
    borderRadius: '10px',
    background: '#ffffff',
    border: '1px solid #e1e5eb',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  errorText: {
    padding: '12px',
    borderRadius: '10px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  resultItem: {
    padding: '12px',
    borderRadius: '12px',
    border: '1px solid #dde3eb',
    background: '#ffffff',
    textAlign: 'left',
    cursor: 'pointer',
    color: '#334155',
    outline: 'none',
    boxShadow: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  },
  resultPath: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#1f2937',
    wordBreak: 'break-word',
  },
  resultLine: {
    marginTop: '6px',
    fontSize: '11px',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  resultSnippet: {
    marginTop: '8px',
    fontSize: '13px',
    lineHeight: '1.5',
    color: '#475569',
    wordBreak: 'break-word',
  },
}
