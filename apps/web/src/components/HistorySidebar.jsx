import { useEffect, useRef, useState } from 'react'
import {
  APP_SIDEBAR_BACKGROUND,
  APP_SIDEBAR_BORDER,
  APP_SIDEBAR_WIDTH,
} from '../config/sidebar'
import { getProjectRevision, listProjectRevisions } from '../services/projects'

const CHANGE_TYPE_META = {
  baseline: { label: 'Baseline', color: '#475569', background: '#f1f5f9' },
  created: { label: 'Created', color: '#047857', background: '#ecfdf5' },
  modified: { label: 'Modified', color: '#1d4ed8', background: '#eff6ff' },
  deleted: { label: 'Deleted', color: '#b91c1c', background: '#fef2f2' },
  renamed: { label: 'Renamed', color: '#b45309', background: '#fffbeb' },
}

function getChangeTypeMeta(changeType) {
  return CHANGE_TYPE_META[changeType] || CHANGE_TYPE_META.modified
}

function formatTimestamp(value) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString()
}

function getRevisionTitle(revision) {
  const label = `${revision?.label || ''}`.trim()
  return label || `Revision ${revision?.id || ''}`.trim()
}

function getRevisionActor(revision) {
  const user = revision?.created_by
  return user?.display_name || user?.email || 'System'
}

function formatChangeCount(count) {
  const normalizedCount = Number(count) || 0
  return `${normalizedCount} change${normalizedCount === 1 ? '' : 's'}`
}

function formatEntryPath(entry) {
  if (entry?.change_type === 'renamed' && entry.previous_path) {
    return `${entry.previous_path} -> ${entry.path}`
  }
  return entry?.path || '(unknown path)'
}

export default function HistorySidebar({
  onClose,
  onRestoreRevision,
  onSelectRevisionEntry,
  projectId,
}) {
  const selectionCallbackRef = useRef(onSelectRevisionEntry)
  const [revisions, setRevisions] = useState([])
  const [selectedRevisionId, setSelectedRevisionId] = useState(null)
  const [selectedRevisionEntryId, setSelectedRevisionEntryId] = useState(null)
  const [revisionDetail, setRevisionDetail] = useState(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    selectionCallbackRef.current = onSelectRevisionEntry
  }, [onSelectRevisionEntry])

  function emitSelection(revision, entry, isLoadingDetail = false) {
    selectionCallbackRef.current?.({
      entry,
      isLoading: isLoadingDetail,
      revision,
    })
  }

  useEffect(() => {
    let isCancelled = false

    async function loadRevisions() {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const payload = await listProjectRevisions(projectId)
        if (isCancelled) return

        const nextRevisions = Array.isArray(payload) ? payload : []
        setRevisions(nextRevisions)
        if (nextRevisions.length === 0) {
          setRevisionDetail(null)
          setSelectedRevisionEntryId(null)
          selectionCallbackRef.current?.({ entry: null, isLoading: false, revision: null })
        }
        setSelectedRevisionId((currentRevisionId) => {
          if (nextRevisions.some((revision) => revision.id === currentRevisionId)) {
            return currentRevisionId
          }
          return nextRevisions[0]?.id || null
        })
      } catch (error) {
        if (isCancelled) return
        setErrorMessage(error.message || 'Failed to load history')
        setRevisions([])
        setSelectedRevisionId(null)
        setSelectedRevisionEntryId(null)
        selectionCallbackRef.current?.({ entry: null, isLoading: false, revision: null })
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadRevisions()

    return () => {
      isCancelled = true
    }
  }, [projectId, reloadNonce])

  useEffect(() => {
    let isCancelled = false

    async function loadRevisionDetail() {
      const selectedRevisionSummary = revisions.find((revision) => revision.id === selectedRevisionId) || null

      if (!selectedRevisionId) {
        setRevisionDetail(null)
        setSelectedRevisionEntryId(null)
        selectionCallbackRef.current?.({ entry: null, isLoading: false, revision: null })
        return
      }

      setIsDetailLoading(true)
      setRevisionDetail(null)
      setSelectedRevisionEntryId(null)
      setErrorMessage('')
      selectionCallbackRef.current?.({
        entry: null,
        isLoading: true,
        revision: selectedRevisionSummary,
      })

      try {
        const payload = await getProjectRevision(projectId, selectedRevisionId)
        if (!isCancelled) {
          const nextEntries = Array.isArray(payload?.entries) ? payload.entries : []
          const nextEntry = nextEntries[0] || null
          setRevisionDetail(payload)
          setSelectedRevisionEntryId(nextEntry?.id || null)
          selectionCallbackRef.current?.({
            entry: nextEntry,
            isLoading: false,
            revision: payload,
          })
        }
      } catch (error) {
        if (isCancelled) return
        setRevisionDetail(null)
        setSelectedRevisionEntryId(null)
        selectionCallbackRef.current?.({
          entry: null,
          isLoading: false,
          revision: selectedRevisionSummary,
        })
        setErrorMessage(error.message || 'Failed to load revision detail')
      } finally {
        if (!isCancelled) {
          setIsDetailLoading(false)
        }
      }
    }

    void loadRevisionDetail()

    return () => {
      isCancelled = true
    }
  }, [projectId, revisions, selectedRevisionId])

  async function handleRestoreClick() {
    const activeRevision = revisionDetail || revisions.find((revision) => revision.id === selectedRevisionId)
    if (!activeRevision || typeof onRestoreRevision !== 'function') return

    const confirmed = window.confirm(
      [
        `Restore the whole project to "${getRevisionTitle(activeRevision)}"?`,
        'Current files will be replaced with that revision state.',
      ].join('\n'),
    )
    if (!confirmed) return

    setIsRestoring(true)
    setErrorMessage('')
    setActionMessage('')

    try {
      const result = await onRestoreRevision(activeRevision)
      setActionMessage(
        result?.status === 'unchanged'
          ? 'Project already matches this revision.'
          : 'Project restored. A rollback revision was recorded.',
      )
      setSelectedRevisionId(activeRevision.id)
      setReloadNonce((current) => current + 1)
    } catch (error) {
      setErrorMessage(error.message || 'Failed to restore revision')
    } finally {
      setIsRestoring(false)
    }
  }

  const selectedRevision = revisions.find((revision) => revision.id === selectedRevisionId) || revisionDetail
  const detailEntries = Array.isArray(revisionDetail?.entries) ? revisionDetail.entries : []

  return (
    <aside style={styles.sidebar}>
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <button onClick={onClose} style={styles.iconButton} type="button">←</button>
          <div style={styles.title}>History</div>
          <button onClick={onClose} style={styles.iconButton} type="button">×</button>
        </div>
        <div style={styles.headerSubtitle}>Explicit saves and project file operations create revisions.</div>
      </div>

      <div style={styles.body}>
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionTitle}>Project Revisions</div>
              <div style={styles.sectionSubtitle}>
                {isLoading ? 'Loading...' : `${revisions.length} revision${revisions.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <button
              disabled={isLoading || isRestoring}
              onClick={() => setReloadNonce((current) => current + 1)}
              style={{
                ...styles.smallButton,
                ...(isLoading || isRestoring ? styles.buttonDisabled : null),
              }}
              type="button"
            >
              Refresh
            </button>
          </div>

          {errorMessage ? <div style={styles.errorCard}>{errorMessage}</div> : null}
          {actionMessage ? <div style={styles.successCard}>{actionMessage}</div> : null}

          {!isLoading && revisions.length === 0 ? (
            <div style={styles.emptyCard}>No saved revisions yet. Press Ctrl+S after editing to create one.</div>
          ) : null}

          <div style={styles.revisionList}>
            {revisions.map((revision) => (
              <button
                key={revision.id}
                onClick={() => {
                  setSelectedRevisionId(revision.id)
                  setActionMessage('')
                }}
                style={{
                  ...styles.revisionCard,
                  ...(revision.id === selectedRevisionId ? styles.revisionCardActive : null),
                }}
                type="button"
              >
                <div style={styles.revisionTitle}>{getRevisionTitle(revision)}</div>
                <div style={styles.revisionMeta}>
                  {formatTimestamp(revision.created_at)}
                </div>
                <div style={styles.revisionFooter}>
                  <span>{getRevisionActor(revision)}</span>
                  <span>{formatChangeCount(revision.change_count)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {selectedRevision ? (
          <section style={styles.section}>
            <div style={styles.detailHeader}>
              <div>
                <div style={styles.detailTitle}>{getRevisionTitle(selectedRevision)}</div>
                <div style={styles.detailMeta}>
                  {`${formatTimestamp(selectedRevision.created_at)} by ${getRevisionActor(selectedRevision)}`}
                </div>
              </div>
              <span style={styles.kindBadge}>{selectedRevision.kind || 'manual'}</span>
            </div>

            {revisionDetail?.description ? (
              <div style={styles.descriptionCard}>{revisionDetail.description}</div>
            ) : null}

            <button
              disabled={isRestoring || isDetailLoading || !revisionDetail}
              onClick={handleRestoreClick}
              style={{
                ...styles.restoreButton,
                ...(isRestoring || isDetailLoading || !revisionDetail ? styles.buttonDisabled : null),
              }}
              type="button"
            >
              {isRestoring ? 'Restoring...' : 'Restore Project'}
            </button>

            <div style={styles.entriesHeader}>
              {isDetailLoading ? 'Loading changed files...' : formatChangeCount(detailEntries.length)}
            </div>

            <div style={styles.entryList}>
              {!isDetailLoading && detailEntries.length === 0 ? (
                <div style={styles.emptyCard}>This revision has no recorded file entries.</div>
              ) : null}
              {detailEntries.map((entry) => {
                const changeMeta = getChangeTypeMeta(entry.change_type)
                return (
                  <button
                    key={entry.id}
                    onClick={() => {
                      setSelectedRevisionEntryId(entry.id)
                      emitSelection(revisionDetail, entry)
                    }}
                    style={{
                      ...styles.entryCard,
                      ...(entry.id === selectedRevisionEntryId ? styles.entryCardActive : null),
                    }}
                    type="button"
                  >
                    <div style={styles.entryTopLine}>
                      <span
                        style={{
                          ...styles.changeBadge,
                          color: changeMeta.color,
                          background: changeMeta.background,
                        }}
                      >
                        {changeMeta.label}
                      </span>
                      <span style={styles.entryKind}>{entry.kind || 'file'}</span>
                    </div>
                    <div style={styles.entryPath}>{formatEntryPath(entry)}</div>
                  </button>
                )
              })}
            </div>
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
    padding: '12px 10px',
    borderBottom: '1px solid #d8dde6',
  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '10px',
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
  headerSubtitle: {
    padding: '9px 10px',
    borderRadius: '10px',
    background: '#ffffff',
    border: '1px solid #e1e5eb',
    color: '#64748b',
    fontSize: '12px',
    lineHeight: '1.5',
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: '10px',
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
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
  smallButton: {
    height: '28px',
    padding: '0 9px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    outline: 'none',
  },
  buttonDisabled: {
    cursor: 'not-allowed',
    opacity: 0.65,
  },
  revisionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  revisionCard: {
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
  revisionCardActive: {
    borderColor: '#93c5fd',
    boxShadow: '0 0 0 2px rgba(147, 197, 253, 0.35)',
  },
  revisionTitle: {
    fontSize: '13px',
    fontWeight: '800',
    color: '#1f2937',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  revisionMeta: {
    marginTop: '6px',
    fontSize: '11px',
    color: '#64748b',
  },
  revisionFooter: {
    marginTop: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    color: '#475569',
    fontSize: '11px',
    fontWeight: '700',
  },
  detailHeader: {
    padding: '12px',
    borderRadius: '12px',
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '10px',
  },
  detailTitle: {
    fontSize: '13px',
    fontWeight: '800',
    color: '#111827',
    lineHeight: '1.4',
  },
  detailMeta: {
    marginTop: '5px',
    fontSize: '11px',
    lineHeight: '1.5',
    color: '#64748b',
  },
  kindBadge: {
    flexShrink: 0,
    height: '22px',
    padding: '0 8px',
    borderRadius: '999px',
    background: '#f1f5f9',
    color: '#475569',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  restoreButton: {
    width: '100%',
    height: '38px',
    borderRadius: '10px',
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '800',
    outline: 'none',
  },
  entriesHeader: {
    padding: '0 2px',
    color: '#64748b',
    fontSize: '12px',
    fontWeight: '700',
  },
  entryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  entryCard: {
    padding: '11px',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    textAlign: 'left',
    outline: 'none',
    boxShadow: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  },
  entryCardActive: {
    borderColor: '#93c5fd',
    boxShadow: '0 0 0 2px rgba(147, 197, 253, 0.35)',
  },
  entryTopLine: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  changeBadge: {
    height: '22px',
    padding: '0 8px',
    borderRadius: '999px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  entryKind: {
    color: '#64748b',
    fontSize: '11px',
    fontWeight: '700',
  },
  entryPath: {
    marginTop: '8px',
    color: '#1f2937',
    fontSize: '12px',
    lineHeight: '1.5',
    wordBreak: 'break-word',
  },
  descriptionCard: {
    padding: '11px',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    color: '#475569',
    fontSize: '12px',
    lineHeight: '1.6',
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
  successCard: {
    padding: '12px',
    borderRadius: '12px',
    background: '#ecfdf5',
    border: '1px solid #bbf7d0',
    color: '#047857',
    fontSize: '13px',
    lineHeight: '1.5',
  },
}
