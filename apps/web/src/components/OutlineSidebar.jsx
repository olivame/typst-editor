function formatOutlineTitle(item) {
  if (typeof item?.title === 'string' && item.title.trim()) return item.title.trim()
  if (typeof item?.text === 'string' && item.text.trim()) return item.text.trim()
  if (typeof item?.label === 'string' && item.label.trim()) return item.label.trim()
  return 'Untitled section'
}

function getHeadingLabel(depth) {
  return `H${Math.min(depth + 1, 6)}`
}

function getItemVisuals(depth) {
  if (depth === 0) {
    return {
      label: {
        fontSize: '14px',
        fontWeight: '700',
        color: '#111827',
      },
      badge: {
        background: '#dbeafe',
        color: '#1d4ed8',
      },
      branch: {
        background: '#93c5fd',
      },
    }
  }

  if (depth === 1) {
    return {
      label: {
        fontSize: '13px',
        fontWeight: '650',
        color: '#1f2937',
      },
      badge: {
        background: '#e0f2fe',
        color: '#0369a1',
      },
      branch: {
        background: '#7dd3fc',
      },
    }
  }

  return {
    label: {
      fontSize: '12px',
      fontWeight: '600',
      color: '#475569',
    },
    badge: {
      background: '#f1f5f9',
      color: '#64748b',
    },
    branch: {
      background: '#cbd5e1',
    },
  }
}

export default function OutlineSidebar({ items, onClose, onSelectItem }) {
  return (
    <aside style={styles.sidebar}>
      <div style={styles.header}>
        <div style={styles.headerRow}>
          <button onClick={onClose} style={styles.iconButton} type="button">←</button>
          <div style={styles.title}>Outline</div>
          <button onClick={onClose} style={styles.iconButton} type="button">×</button>
        </div>
      </div>

      <div style={styles.body}>
        {items.length === 0 ? (
          <div style={styles.emptyState}>
            No headings found in the current document.
          </div>
        ) : null}

        {items.map((item, index) => {
          const depth = Math.max(Number(item?.depth) || 0, 0)
          const visuals = getItemVisuals(depth)
          const isClickable = Boolean(
            item?.location
            || (typeof item?.title === 'string' && item.title.trim())
            || (typeof item?.text === 'string' && item.text.trim())
            || (typeof item?.label === 'string' && item.label.trim()),
          )
          const pageNumber = item?.position?.page_no

          return (
            <button
              key={item.pathKey || `${formatOutlineTitle(item)}-${index}`}
              disabled={!isClickable}
              onClick={() => {
                if (!isClickable) return
                onSelectItem(item)
              }}
              style={{
                ...styles.outlineItem,
                paddingLeft: `${14 + Math.min(depth, 6) * 18}px`,
                ...(isClickable ? null : styles.outlineItemDisabled),
              }}
              type="button"
            >
              <span style={styles.branchColumn}>
                <span
                  style={{
                    ...styles.branchLine,
                    ...visuals.branch,
                    marginLeft: `${Math.min(depth, 6) * 2}px`,
                  }}
                />
              </span>
              <span style={{ ...styles.headingBadge, ...visuals.badge }}>
                {getHeadingLabel(depth)}
              </span>
              <span style={styles.outlineTextColumn}>
                <span style={{ ...styles.outlineLabel, ...visuals.label }}>
                  {formatOutlineTitle(item)}
                </span>
                <span style={styles.outlineSubline}>
                  <span style={styles.outlineDepthText}>Level {depth + 1}</span>
                  {item?.location?.lineNumber ? (
                    <span style={styles.outlineMeta}>L{item.location.lineNumber}</span>
                  ) : pageNumber ? (
                    <span style={styles.outlineMeta}>P{pageNumber}</span>
                  ) : null}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

const styles = {
  sidebar: {
    width: '308px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#f3f4f6',
    color: '#334155',
    borderRight: '1px solid #d3d8e0',
  },
  header: {
    padding: '12px 10px',
    borderBottom: '1px solid #d8dde6',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
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
  body: {
    flex: 1,
    overflow: 'auto',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  emptyState: {
    padding: '12px',
    borderRadius: '10px',
    background: '#ffffff',
    border: '1px solid #e1e5eb',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  outlineItem: {
    minHeight: '46px',
    padding: '10px 12px',
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
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  outlineItemDisabled: {
    cursor: 'default',
    opacity: 0.7,
  },
  branchColumn: {
    width: '12px',
    display: 'flex',
    justifyContent: 'center',
    flexShrink: 0,
    paddingTop: '3px',
  },
  branchLine: {
    width: '2px',
    minHeight: '26px',
    borderRadius: '999px',
  },
  headingBadge: {
    minWidth: '30px',
    height: '22px',
    padding: '0 7px',
    borderRadius: '999px',
    fontSize: '10px',
    fontWeight: '800',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '1px',
  },
  outlineTextColumn: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  outlineLabel: {
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  outlineSubline: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  outlineDepthText: {
    fontSize: '11px',
    color: '#94a3b8',
  },
  outlineMeta: {
    fontSize: '11px',
    color: '#64748b',
  },
}
