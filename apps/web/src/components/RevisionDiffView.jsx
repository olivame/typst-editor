import { useEffect, useMemo, useRef } from 'react'

const MAX_LCS_DIFF_CELLS = 20000

function splitDiffLines(value) {
  if (typeof value !== 'string') return []
  return value.split('\n')
}

function buildIndexedDiffRows(beforeLines, afterLines) {
  const rowCount = Math.max(beforeLines.length, afterLines.length)

  return Array.from({ length: rowCount }, (_, index) => {
    const beforeLine = index < beforeLines.length ? beforeLines[index] : ''
    const afterLine = index < afterLines.length ? afterLines[index] : ''
    return {
      id: index,
      beforeLine,
      afterLine,
      beforeLineNumber: index < beforeLines.length ? index + 1 : '',
      afterLineNumber: index < afterLines.length ? index + 1 : '',
      changed: beforeLine !== afterLine,
    }
  })
}

function buildLcsDiffRows(beforeLines, afterLines) {
  const beforeCount = beforeLines.length
  const afterCount = afterLines.length
  const dp = Array.from({ length: beforeCount + 1 }, () => Array(afterCount + 1).fill(0))

  for (let beforeIndex = beforeCount - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterCount - 1; afterIndex >= 0; afterIndex -= 1) {
      dp[beforeIndex][afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? dp[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(dp[beforeIndex + 1][afterIndex], dp[beforeIndex][afterIndex + 1])
    }
  }

  const rows = []
  let beforeIndex = 0
  let afterIndex = 0
  while (beforeIndex < beforeCount || afterIndex < afterCount) {
    if (
      beforeIndex < beforeCount
      && afterIndex < afterCount
      && beforeLines[beforeIndex] === afterLines[afterIndex]
    ) {
      rows.push({
        id: rows.length,
        beforeLine: beforeLines[beforeIndex],
        afterLine: afterLines[afterIndex],
        beforeLineNumber: beforeIndex + 1,
        afterLineNumber: afterIndex + 1,
        changed: false,
      })
      beforeIndex += 1
      afterIndex += 1
      continue
    }

    if (afterIndex >= afterCount || (
      beforeIndex < beforeCount
      && dp[beforeIndex + 1][afterIndex] >= dp[beforeIndex][afterIndex + 1]
    )) {
      rows.push({
        id: rows.length,
        beforeLine: beforeLines[beforeIndex],
        afterLine: '',
        beforeLineNumber: beforeIndex + 1,
        afterLineNumber: '',
        changed: true,
      })
      beforeIndex += 1
      continue
    }

    rows.push({
      id: rows.length,
      beforeLine: '',
      afterLine: afterLines[afterIndex],
      beforeLineNumber: '',
      afterLineNumber: afterIndex + 1,
      changed: true,
    })
    afterIndex += 1
  }

  return rows
}

function buildSideBySideRows(beforeState, afterState) {
  const beforeLines = beforeState?.content_available ? splitDiffLines(beforeState.content) : []
  const afterLines = afterState?.content_available ? splitDiffLines(afterState.content) : []
  if (beforeLines.length * afterLines.length > MAX_LCS_DIFF_CELLS) {
    return buildIndexedDiffRows(beforeLines, afterLines)
  }
  return buildLcsDiffRows(beforeLines, afterLines)
}

function buildRevisionDiffRows(entry) {
  return buildSideBySideRows(entry?.diff?.before || null, entry?.diff?.after || null)
}

function getRevisionDiffState(entry, side) {
  return entry?.diff?.[side] || null
}

function getStateSummary(state, fallback) {
  if (!state?.exists) return fallback
  if (state.kind === 'folder') return 'Folder'
  if (state.is_binary) return 'Binary file'
  return `${splitDiffLines(state.content || '').length} lines`
}

function getLineMarker(row, isBefore) {
  if (!row.changed) return ''
  if (isBefore) return row.beforeLineNumber ? '-' : ''
  return row.afterLineNumber ? '+' : ''
}

function getLineChangeStyle(row, isBefore) {
  if (!row.changed) return null
  if (isBefore && row.beforeLineNumber) return styles.diffLineRemoved
  if (!isBefore && row.afterLineNumber) return styles.diffLineAdded
  return styles.diffLineChangeSpacer
}

export default function RevisionDiffView({
  emptyText,
  entry,
  onRegisterScroller,
  onScrollSync,
  rows: providedRows,
  side,
  title,
  zoom = 1,
}) {
  const scrollerRef = useRef(null)
  const isBefore = side === 'before'
  const state = getRevisionDiffState(entry, side)
  const rows = useMemo(
    () => providedRows || buildRevisionDiffRows(entry),
    [entry, providedRows],
  )
  const lineKey = isBefore ? 'beforeLine' : 'afterLine'
  const lineNumberKey = isBefore ? 'beforeLineNumber' : 'afterLineNumber'
  const fontSize = Math.max(10, Math.round(12 * zoom * 10) / 10)
  const lineHeight = Math.max(18, Math.round(19 * zoom * 10) / 10)

  useEffect(() => {
    const scroller = scrollerRef.current
    onRegisterScroller?.(side, scroller)

    return () => {
      onRegisterScroller?.(side, null)
    }
  }, [onRegisterScroller, side, state?.content_available])

  function handleScroll(event) {
    onScrollSync?.(side, event.currentTarget)
  }

  if (!entry) {
    return (
      <div style={styles.emptySurface}>
        <div style={styles.emptyCard}>{emptyText}</div>
      </div>
    )
  }

  return (
    <div style={styles.surface}>
      <div style={styles.fileHeader}>
        <div style={styles.fileTitle}>{title}</div>
        <div style={styles.fileSummary}>{getStateSummary(state, emptyText)}</div>
      </div>
      <div style={styles.filePath}>{state?.path || emptyText}</div>
      {!state?.content_available ? (
        <div style={styles.unavailable}>
          {state?.exists ? 'Content diff is not available for folders or binary files.' : emptyText}
        </div>
      ) : (
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          style={{
            ...styles.codeScroller,
            fontSize: `${fontSize}px`,
            lineHeight: `${lineHeight}px`,
          }}
        >
          {rows.map((row) => {
            const marker = getLineMarker(row, isBefore)
            return (
              <div
                key={`${side}-${row.id}`}
                style={{
                  ...styles.diffLine,
                  minHeight: `${lineHeight}px`,
                  ...getLineChangeStyle(row, isBefore),
                }}
              >
                <span style={styles.lineNumber}>{row[lineNumberKey]}</span>
                <span
                  style={{
                    ...styles.lineMarker,
                    ...(marker === '-' ? styles.lineMarkerRemoved : null),
                    ...(marker === '+' ? styles.lineMarkerAdded : null),
                  }}
                >
                  {marker}
                </span>
                <span style={styles.lineText}>{row[lineKey] || ' '}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const styles = {
  surface: {
    height: '100%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#fbfbfc',
  },
  emptySurface: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '28px',
    background: '#fbfbfc',
  },
  emptyCard: {
    maxWidth: '420px',
    padding: '18px 20px',
    borderRadius: '16px',
    border: '1px solid #d8dde6',
    background: '#ffffff',
    color: '#64748b',
    fontSize: '14px',
    lineHeight: '1.6',
    textAlign: 'center',
  },
  fileHeader: {
    minHeight: '42px',
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    flexShrink: 0,
  },
  fileTitle: {
    color: '#1f2937',
    fontSize: '12px',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  fileSummary: {
    color: '#64748b',
    fontSize: '11px',
    fontWeight: '700',
    whiteSpace: 'nowrap',
  },
  filePath: {
    padding: '9px 14px',
    borderBottom: '1px solid #e5e7eb',
    color: '#475569',
    fontSize: '12px',
    fontWeight: '700',
    lineHeight: '1.45',
    wordBreak: 'break-word',
    background: '#ffffff',
    flexShrink: 0,
  },
  unavailable: {
    padding: '18px 14px',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  codeScroller: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    background: '#ffffff',
    color: '#334155',
    fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
  },
  diffLine: {
    display: 'grid',
    gridTemplateColumns: '58px 26px minmax(0, 1fr)',
  },
  diffLineRemoved: {
    background: '#ffe4e6',
    boxShadow: 'inset 3px 0 0 #ef4444',
  },
  diffLineAdded: {
    background: '#dcfce7',
    boxShadow: 'inset 3px 0 0 #22c55e',
  },
  diffLineChangeSpacer: {
    background: '#fafafa',
  },
  lineNumber: {
    padding: '0 10px 0 6px',
    color: '#94a3b8',
    textAlign: 'right',
    userSelect: 'none',
    borderRight: '1px solid #e5e7eb',
    background: 'rgba(248, 250, 252, 0.72)',
  },
  lineMarker: {
    padding: '0 7px',
    color: '#94a3b8',
    textAlign: 'center',
    userSelect: 'none',
    fontWeight: '900',
    borderRight: '1px solid #e5e7eb',
  },
  lineMarkerRemoved: {
    color: '#b91c1c',
    background: 'rgba(254, 202, 202, 0.65)',
  },
  lineMarkerAdded: {
    color: '#047857',
    background: 'rgba(187, 247, 208, 0.75)',
  },
  lineText: {
    padding: '0 12px',
    whiteSpace: 'pre',
  },
}
