const MENU_ITEMS = ['Typst', 'File', 'Edit', 'View', 'Help']

export default function EditorToolbar({
  compileResult,
  currentPath,
  onBack,
  onDownload,
  onSavePreview,
}) {
  return (
    <div style={styles.shell}>
      <div style={styles.left}>
        <button onClick={onBack} style={styles.backButton}>Projects</button>
        <div style={styles.menuGroup}>
          {MENU_ITEMS.map((item) => (
            <button key={item} style={styles.menuButton}>{item}</button>
          ))}
        </div>
      </div>

      <div style={styles.center}>
        <span style={styles.projectTitle}>{currentPath || 'Typst Playground'}</span>
      </div>

      <div style={styles.right}>
        {compileResult ? <span style={styles.statusPill}>{compileResult}</span> : null}
        <button onClick={onSavePreview} style={styles.iconButton} title="Save and preview">
          💾
        </button>
        <button onClick={onDownload} style={styles.iconButton} title="Download PDF">
          ⬇
        </button>
      </div>
    </div>
  )
}

const styles = {
  shell: {
    height: '52px',
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems: 'center',
    gap: '16px',
    padding: '0 18px',
    borderBottom: '1px solid #d8d8de',
    background: '#ececee',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    minWidth: 0,
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '10px',
    minWidth: 0,
  },
  backButton: {
    height: '32px',
    padding: '0 12px',
    borderRadius: '8px',
    border: '1px solid #cbccd3',
    background: '#ffffff',
    color: '#2a2d35',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  menuGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    flexWrap: 'wrap',
  },
  menuButton: {
    height: '30px',
    padding: '0 10px',
    border: 'none',
    background: 'transparent',
    color: '#50515b',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  projectTitle: {
    maxWidth: '420px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '13px',
    fontWeight: '700',
    color: '#3a3d45',
  },
  statusPill: {
    maxWidth: '240px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '7px 10px',
    borderRadius: '999px',
    background: '#ffffff',
    border: '1px solid #d7d8de',
    color: '#4a5565',
    fontSize: '12px',
    fontWeight: '600',
  },
  iconButton: {
    height: '34px',
    width: '34px',
    borderRadius: '9px',
    border: '1px solid #c9cad2',
    background: '#ffffff',
    color: '#353844',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: '600',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
}
