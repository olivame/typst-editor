function formatOutlineTitle(item) {
  if (typeof item?.title === 'string' && item.title.trim()) return item.title.trim()
  if (typeof item?.text === 'string' && item.text.trim()) return item.text.trim()
  if (typeof item?.label === 'string' && item.label.trim()) return item.label.trim()
  return 'Untitled section'
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
          const isClickable = Boolean(item?.location)

          return (
            <button
              key={`${formatOutlineTitle(item)}-${index}`}
              disabled={!isClickable}
              onClick={() => {
                if (!isClickable) return
                onSelectItem(item)
              }}
              style={{
                ...styles.outlineItem,
                paddingLeft: `${16 + Math.min(depth, 6) * 18}px`,
                ...(isClickable ? null : styles.outlineItemDisabled),
              }}
              type="button"
            >
              <span style={styles.outlineDepthMarker}>{depth > 0 ? '└' : '•'}</span>
              <span style={styles.outlineLabel}>{formatOutlineTitle(item)}</span>
              {item?.location?.lineNumber ? (
                <span style={styles.outlineMeta}>L{item.location.lineNumber}</span>
              ) : null}
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
    minHeight: '42px',
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
    alignItems: 'center',
    gap: '8px',
  },
  outlineItemDisabled: {
    cursor: 'default',
    opacity: 0.7,
  },
  outlineDepthMarker: {
    color: '#94a3b8',
    fontSize: '12px',
    flexShrink: 0,
  },
  outlineLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: '13px',
    fontWeight: '600',
    color: '#1f2937',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  outlineMeta: {
    fontSize: '11px',
    color: '#64748b',
    flexShrink: 0,
  },
}
