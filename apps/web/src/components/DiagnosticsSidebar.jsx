import { useState } from 'react'
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

function formatTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function getUserLabel(user) {
  return user?.display_name || user?.email || 'Unknown user'
}

function formatCommentSummary(statusFilter, count, isLoading) {
  if (isLoading) return 'Loading comments...'
  const label = statusFilter === 'all'
    ? 'thread'
    : `${statusFilter} thread`
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function getCommentQuote(thread) {
  const quote = `${thread?.quote_text || thread?.selected_text || ''}`.trim()
  if (!quote) return '(no selected text)'
  return quote.length > 180 ? `${quote.slice(0, 180)}...` : quote
}

export default function DiagnosticsSidebar({
  commentStatusFilter = 'open',
  commentsError = '',
  commentsLoading = false,
  commentThreads = [],
  diagnostics,
  hasTextSelection = false,
  onClose,
  onCommentStatusFilterChange,
  onCreateComment,
  onRefreshComments,
  onReplyToComment,
  onSelectComment,
  onSelectDiagnostic,
  onUpdateCommentStatus,
  rawStatus,
  selectedEntry,
  statusKind,
}) {
  const [newCommentBody, setNewCommentBody] = useState('')
  const [replyDrafts, setReplyDrafts] = useState({})
  const [isCreatingComment, setIsCreatingComment] = useState(false)
  const [pendingThreadId, setPendingThreadId] = useState(null)
  const compilerSummary = diagnostics.length > 0
    ? formatDiagnosticCount(diagnostics.length)
    : statusKind ? `${statusKind}` : 'No compiler issues'
  const canCommentOnCurrentFile = Boolean(
    selectedEntry
    && selectedEntry.kind === 'file'
    && !selectedEntry.is_binary,
  )
  const canCreateComment = canCommentOnCurrentFile && hasTextSelection

  async function handleCreateCommentSubmit(event) {
    event.preventDefault()
    const body = newCommentBody.trim()
    if (!body || typeof onCreateComment !== 'function') return

    setIsCreatingComment(true)
    try {
      const thread = await onCreateComment(body)
      if (thread) {
        setNewCommentBody('')
      }
    } finally {
      setIsCreatingComment(false)
    }
  }

  async function handleReplySubmit(event, thread) {
    event.preventDefault()
    const body = `${replyDrafts[thread.id] || ''}`.trim()
    if (!body || typeof onReplyToComment !== 'function') return

    setPendingThreadId(thread.id)
    try {
      const updatedThread = await onReplyToComment(thread, body)
      if (updatedThread) {
        setReplyDrafts((current) => ({ ...current, [thread.id]: '' }))
      }
    } finally {
      setPendingThreadId(null)
    }
  }

  async function handleStatusClick(thread, status) {
    if (typeof onUpdateCommentStatus !== 'function') return
    setPendingThreadId(thread.id)
    try {
      await onUpdateCommentStatus(thread, status)
    } finally {
      setPendingThreadId(null)
    }
  }

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
                  {diagnostic.notes?.length ? (
                    <div style={styles.diagnosticNotes}>
                      {diagnostic.notes.map((note) => (
                        <div key={note} style={styles.diagnosticNote}>
                          {note}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </button>
              )
            })
          )}
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitle}>💬 Comments</div>
            <div style={styles.sectionSubtitle}>
              {formatCommentSummary(commentStatusFilter, commentThreads.length, commentsLoading)}
            </div>
          </div>

          <form onSubmit={handleCreateCommentSubmit} style={styles.commentComposer}>
            <div style={styles.composerTitle}>Comment on selected text</div>
            <div style={styles.composerHint}>
              {canCommentOnCurrentFile
                ? hasTextSelection
                  ? 'Write a note for the current selection, then add it.'
                  : 'Select text in the editor first; the comment will anchor to that range.'
                : 'Open an editable text file before adding comments.'}
            </div>
            <textarea
              disabled={!canCreateComment || isCreatingComment}
              onChange={(event) => setNewCommentBody(event.target.value)}
              placeholder="Ask a question, request a change, or leave review context..."
              rows={3}
              style={{
                ...styles.commentTextarea,
                ...(!canCreateComment ? styles.commentTextareaDisabled : null),
              }}
              value={newCommentBody}
            />
            <div style={styles.composerActions}>
              <button
                disabled={!canCreateComment || isCreatingComment || !newCommentBody.trim()}
                style={{
                  ...styles.primaryButton,
                  ...(!canCreateComment || isCreatingComment || !newCommentBody.trim()
                    ? styles.buttonDisabled
                    : null),
                }}
                type="submit"
              >
                {isCreatingComment ? 'Adding...' : 'Add Comment'}
              </button>
              <button
                disabled={commentsLoading}
                onClick={() => onRefreshComments?.()}
                style={{
                  ...styles.secondaryButton,
                  ...(commentsLoading ? styles.buttonDisabled : null),
                }}
                type="button"
              >
                Refresh
              </button>
            </div>
          </form>

          <div style={styles.commentFilters}>
            {['open', 'resolved', 'all'].map((filter) => (
              <button
                key={filter}
                onClick={() => onCommentStatusFilterChange?.(filter)}
                style={{
                  ...styles.filterButton,
                  ...(commentStatusFilter === filter ? styles.filterButtonActive : null),
                }}
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>

          {commentsError ? <div style={styles.errorCard}>{commentsError}</div> : null}

          {!commentsLoading && commentThreads.length === 0 ? (
            <div style={styles.emptyCard}>
              No {commentStatusFilter === 'all' ? '' : `${commentStatusFilter} `}comment threads yet.
            </div>
          ) : null}

          <div style={styles.commentList}>
            {commentThreads.map((thread) => {
              const isResolved = thread.status === 'resolved'
              const firstComment = thread.comments?.[0] || null
              const replies = (thread.comments || []).slice(1)
              const isPending = pendingThreadId === thread.id
              return (
                <article
                  key={thread.id}
                  style={{
                    ...styles.commentCard,
                    ...(isResolved ? styles.commentCardResolved : null),
                  }}
                >
                  <div style={styles.commentCardHeader}>
                    <span
                      style={{
                        ...styles.commentStatusBadge,
                        ...(isResolved ? styles.commentStatusBadgeResolved : null),
                      }}
                    >
                      {isResolved ? 'Resolved' : 'Open'}
                    </span>
                    <span style={styles.commentPath}>{thread.path}</span>
                  </div>

                  <button
                    onClick={() => onSelectComment?.(thread)}
                    style={styles.quoteButton}
                    title="Jump to commented text"
                    type="button"
                  >
                    {getCommentQuote(thread)}
                  </button>

                  {firstComment ? (
                    <div style={styles.commentMessage}>
                      <div style={styles.commentMeta}>
                        {`${getUserLabel(firstComment.author)} · ${formatTimestamp(firstComment.created_at)}`}
                      </div>
                      <div style={styles.commentBodyText}>{firstComment.body}</div>
                    </div>
                  ) : null}

                  {replies.length > 0 ? (
                    <div style={styles.replyList}>
                      {replies.map((comment) => (
                        <div key={comment.id} style={styles.replyCard}>
                          <div style={styles.commentMeta}>
                            {`${getUserLabel(comment.author)} · ${formatTimestamp(comment.created_at)}`}
                          </div>
                          <div style={styles.commentBodyText}>{comment.body}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <form onSubmit={(event) => handleReplySubmit(event, thread)} style={styles.replyComposer}>
                    <textarea
                      disabled={isPending}
                      onChange={(event) => {
                        setReplyDrafts((current) => ({
                          ...current,
                          [thread.id]: event.target.value,
                        }))
                      }}
                      placeholder="Reply..."
                      rows={2}
                      style={styles.replyTextarea}
                      value={replyDrafts[thread.id] || ''}
                    />
                    <div style={styles.commentActions}>
                      <button
                        disabled={isPending || !`${replyDrafts[thread.id] || ''}`.trim()}
                        style={{
                          ...styles.secondaryButton,
                          ...(isPending || !`${replyDrafts[thread.id] || ''}`.trim()
                            ? styles.buttonDisabled
                            : null),
                        }}
                        type="submit"
                      >
                        Reply
                      </button>
                      <button
                        disabled={isPending}
                        onClick={() => handleStatusClick(thread, isResolved ? 'open' : 'resolved')}
                        style={{
                          ...styles.resolveButton,
                          ...(isResolved ? styles.reopenButton : null),
                          ...(isPending ? styles.buttonDisabled : null),
                        }}
                        type="button"
                      >
                        {isResolved ? 'Reopen' : 'Resolve'}
                      </button>
                    </div>
                  </form>
                </article>
              )
            })}
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitle}>✎ Misspellings</div>
            <div style={styles.sectionSubtitle}>No spelling mistakes found.</div>
          </div>
          <div style={styles.emptyCard}>Great.</div>
        </section>

        {rawStatus ? (
          <section style={styles.section}>
            <details style={styles.debugPanel}>
              <summary style={styles.debugSummary}>Raw Preview Status</summary>
              <pre style={styles.debugPre}>
                {JSON.stringify(rawStatus, null, 2)}
              </pre>
            </details>
          </section>
        ) : null}
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
  errorCard: {
    padding: '12px',
    borderRadius: '12px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    fontSize: '13px',
    lineHeight: '1.5',
  },
  commentComposer: {
    padding: '12px',
    borderRadius: '14px',
    border: '1px solid #d8dee8',
    background: '#ffffff',
    display: 'grid',
    gap: '8px',
  },
  composerTitle: {
    color: '#1f2937',
    fontSize: '13px',
    fontWeight: '800',
  },
  composerHint: {
    color: '#64748b',
    fontSize: '12px',
    lineHeight: '1.45',
  },
  commentTextarea: {
    width: '100%',
    minHeight: '76px',
    resize: 'vertical',
    padding: '9px 10px',
    borderRadius: '10px',
    border: '1px solid #cfd8e3',
    background: '#fbfdff',
    color: '#1f2937',
    fontSize: '13px',
    lineHeight: '1.45',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  },
  commentTextareaDisabled: {
    cursor: 'not-allowed',
    opacity: 0.65,
  },
  composerActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  primaryButton: {
    height: '32px',
    padding: '0 11px',
    borderRadius: '9px',
    border: '1px solid #2563eb',
    background: '#2563eb',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '800',
    outline: 'none',
  },
  secondaryButton: {
    height: '32px',
    padding: '0 10px',
    borderRadius: '9px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '800',
    outline: 'none',
  },
  resolveButton: {
    height: '32px',
    padding: '0 10px',
    borderRadius: '9px',
    border: '1px solid #bbf7d0',
    background: '#ecfdf5',
    color: '#047857',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '800',
    outline: 'none',
  },
  reopenButton: {
    borderColor: '#bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  buttonDisabled: {
    cursor: 'not-allowed',
    opacity: 0.6,
  },
  commentFilters: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px',
  },
  filterButton: {
    height: '30px',
    borderRadius: '9px',
    border: '1px solid #d7dce5',
    background: '#ffffff',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '800',
    textTransform: 'capitalize',
    outline: 'none',
  },
  filterButtonActive: {
    borderColor: '#93c5fd',
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  commentList: {
    display: 'grid',
    gap: '10px',
  },
  commentCard: {
    padding: '12px',
    borderRadius: '14px',
    border: '1px solid #dbe4f0',
    background: '#ffffff',
    display: 'grid',
    gap: '10px',
  },
  commentCardResolved: {
    background: '#f8fafc',
    opacity: 0.88,
  },
  commentCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
  },
  commentStatusBadge: {
    flexShrink: 0,
    height: '22px',
    padding: '0 8px',
    borderRadius: '999px',
    background: '#ecfdf5',
    color: '#047857',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  commentStatusBadgeResolved: {
    background: '#f1f5f9',
    color: '#64748b',
  },
  commentPath: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#475569',
    fontSize: '11px',
    fontWeight: '800',
  },
  quoteButton: {
    padding: '9px 10px',
    borderRadius: '10px',
    border: '1px solid #dbeafe',
    background: '#eff6ff',
    color: '#1e3a8a',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: '700',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    outline: 'none',
  },
  commentMessage: {
    display: 'grid',
    gap: '4px',
  },
  commentMeta: {
    color: '#94a3b8',
    fontSize: '11px',
    fontWeight: '700',
    lineHeight: '1.35',
  },
  commentBodyText: {
    color: '#334155',
    fontSize: '13px',
    lineHeight: '1.55',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  replyList: {
    display: 'grid',
    gap: '7px',
    paddingLeft: '10px',
    borderLeft: '2px solid #e2e8f0',
  },
  replyCard: {
    display: 'grid',
    gap: '4px',
  },
  replyComposer: {
    display: 'grid',
    gap: '8px',
  },
  replyTextarea: {
    width: '100%',
    resize: 'vertical',
    padding: '8px 9px',
    borderRadius: '10px',
    border: '1px solid #d7dce5',
    background: '#fbfdff',
    color: '#1f2937',
    fontSize: '12px',
    lineHeight: '1.45',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  },
  commentActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
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
  diagnosticNotes: {
    marginTop: '10px',
    display: 'grid',
    gap: '6px',
  },
  diagnosticNote: {
    fontSize: '12px',
    lineHeight: '1.5',
    color: '#6b7280',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  debugPanel: {
    padding: '10px 12px',
    borderRadius: '12px',
    background: '#ffffff',
    border: '1px solid #d6dbe4',
  },
  debugSummary: {
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    color: '#334155',
    userSelect: 'none',
  },
  debugPre: {
    margin: '10px 0 0',
    padding: '10px',
    borderRadius: '10px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    color: '#334155',
    fontSize: '11px',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowX: 'auto',
    fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
  },
}
