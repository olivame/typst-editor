import {
  APP_SIDEBAR_BACKGROUND,
  APP_SIDEBAR_BORDER,
  APP_SIDEBAR_WIDTH,
} from '../config/sidebar'

function formatDiagnosticCount(count) {
  if (count === 1) return '1 compiler issue'
  return `${count} compiler issues`
}

function formatSeverityLabel(severity) {
  const value = `${severity || 'error'}`.toLowerCase()
  if (value.includes('warn')) return 'Warning'
  if (value.includes('info')) return 'Info'
  return 'Error'
}

function getSeverityStyles(severity) {
  const value = `${severity || 'error'}`.toLowerCase()
  if (value.includes('warn')) {
    return {
      badge: { background: '#fff7ed', color: '#c2410c' },
      card: { borderColor: '#fdba74', background: '#fffaf5' },
      text: { color: '#9a3412' },
    }
  }
  if (value.includes('info')) {
    return {
      badge: { background: '#eff6ff', color: '#1d4ed8' },
      card: { borderColor: '#93c5fd', background: '#f8fbff' },
      text: { color: '#1d4ed8' },
    }
  }

  return {
    badge: { background: '#fef2f2', color: '#b91c1c' },
    card: { borderColor: '#fca5a5', background: '#fff5f5' },
    text: { color: '#b91c1c' },
  }
}

export default function DiagnosticsSidebar({
  diagnostics,
  onClose,
  onSelectDiagnostic,
  statusKind,
}) {
  const compilerSummary = diagnostics.length > 0
    ? formatDiagnosticCount(diagnostics.length)
    : statusKind ? `${statusKind}` : 'No compiler issues'

  return (
    <aside style={styles.sidebar}>
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <div style={styles.title}>Improve</div>
          <button onClick={onClose} style={styles.closeButton} type="button">×</button>
        </div>
      </div>

      <div style={styles.body}>
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitle}>⚙ Typst</div>
            <div style={styles.sectionSubtitle}>{compilerSummary}</div>
          </div>

          {diagnostics.length === 0 ? (
            <div style={styles.emptyCard}>
              No compiler issues in the latest preview state.
            </div>
          ) : (
            diagnostics.map((diagnostic, index) => {
              const severityStyles = getSeverityStyles(diagnostic.severity)
              const isClickable = Boolean(diagnostic.location)

              return (
                <button
                  key={`${diagnostic.message}-${index}`}
                  disabled={!isClickable}
                  onClick={() => {
                    if (!isClickable) return
                    onSelectDiagnostic(diagnostic)
                  }}
                  style={{
                    ...styles.diagnosticCard,
                    ...severityStyles.card,
                    ...(isClickable ? null : styles.diagnosticCardDisabled),
                  }}
                  type="button"
                >
                  <div style={styles.diagnosticHeader}>
                    <span style={{ ...styles.severityBadge, ...severityStyles.badge }}>
                      {formatSeverityLabel(diagnostic.severity)}
                    </span>
                    {diagnostic.path ? <span style={styles.diagnosticPath}>{diagnostic.path}</span> : null}
                  </div>
                  <div style={{ ...styles.diagnosticMessage, ...severityStyles.text }}>
                    {diagnostic.message}
                  </div>
                  {diagnostic.locationLabel ? (
                    <div style={styles.diagnosticMeta}>{diagnostic.locationLabel}</div>
                  ) : null}
                </button>
              )
            })
          )}
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitle}>💬 Comments</div>
            <div style={styles.sectionSubtitle}>There are no comments.</div>
          </div>
          <div style={styles.emptyCard}>Add collaboration comments later if needed.</div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitle}>✎ Misspellings</div>
            <div style={styles.sectionSubtitle}>No spelling mistakes found.</div>
          </div>
          <div style={styles.emptyCard}>Great.</div>
        </section>
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
    padding: '14px 12px 10px',
    borderBottom: '1px solid #d8dde6',
  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
  },
  title: {
    fontSize: '15px',
    fontWeight: '800',
    color: '#1f2937',
    marginRight: 'auto',
  },
  closeButton: {
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
    flexShrink: 0,
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sectionHeader: {
    padding: '10px 12px',
    borderRadius: '12px',
    background: '#e5e7eb',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#1f2937',
  },
  sectionSubtitle: {
    marginTop: '3px',
    fontSize: '12px',
    color: '#6b7280',
  },
  emptyCard: {
    padding: '12px',
    borderRadius: '12px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: '1.5',
  },
  diagnosticCard: {
    padding: '12px',
    borderRadius: '12px',
    border: '1px solid #fecaca',
    background: '#fff5f5',
    textAlign: 'left',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  },
  diagnosticCardDisabled: {
    cursor: 'default',
    opacity: 0.7,
  },
  diagnosticHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  severityBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '54px',
    height: '22px',
    padding: '0 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: '700',
  },
  diagnosticPath: {
    fontSize: '11px',
    color: '#6b7280',
    wordBreak: 'break-word',
  },
  diagnosticMessage: {
    marginTop: '10px',
    fontSize: '14px',
    fontWeight: '700',
    lineHeight: '1.45',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  diagnosticMeta: {
    marginTop: '8px',
    fontSize: '12px',
    color: '#6b7280',
  },
}
