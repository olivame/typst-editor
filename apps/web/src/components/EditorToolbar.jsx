import { useEffect, useRef, useState } from 'react'

export default function EditorToolbar({
  compileResult,
  currentPath,
  menuSections,
  onBack,
  onDownload,
  onSavePreview,
}) {
  const shellRef = useRef(null)
  const [openMenuLabel, setOpenMenuLabel] = useState('')

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!shellRef.current?.contains(event.target)) {
        setOpenMenuLabel('')
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpenMenuLabel('')
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div ref={shellRef} style={styles.shell}>
      <div style={styles.left}>
        <button onClick={onBack} style={styles.backButton} type="button">Projects</button>
        <div style={styles.menuGroup}>
          {menuSections.map((section) => {
            const isOpen = openMenuLabel === section.label

            return (
              <div key={section.label} style={styles.menuShell}>
                <button
                  onClick={() => setOpenMenuLabel((current) => (current === section.label ? '' : section.label))}
                  style={{
                    ...styles.menuButton,
                    ...(isOpen ? styles.menuButtonActive : null),
                  }}
                  type="button"
                >
                  {section.label}
                </button>

                {isOpen ? (
                  <div style={styles.menuPanel}>
                    {section.items.map((item, index) => {
                      if (item.type === 'separator') {
                        return <div key={`${section.label}-separator-${index}`} style={styles.menuSeparator} />
                      }

                      return (
                        <button
                          key={`${section.label}-${item.label}`}
                          disabled={item.disabled}
                          onClick={() => {
                            setOpenMenuLabel('')
                            item.onSelect?.()
                          }}
                          style={{
                            ...styles.menuItem,
                            ...(item.disabled ? styles.menuItemDisabled : null),
                          }}
                          type="button"
                        >
                          <span style={styles.menuItemLabel}>{item.label}</span>
                          {item.shortcut ? <span style={styles.menuShortcut}>{item.shortcut}</span> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div style={styles.center}>
        <span style={styles.projectTitle}>{currentPath || 'Typst Playground'}</span>
      </div>

      <div style={styles.right}>
        {compileResult ? <span style={styles.statusPill}>{compileResult}</span> : null}
        <button onClick={onSavePreview} style={styles.iconButton} title="Save and preview" type="button">
          💾
        </button>
        <button onClick={onDownload} style={styles.iconButton} title="Download PDF" type="button">
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
    position: 'relative',
    zIndex: 4,
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
  menuShell: {
    position: 'relative',
  },
  menuButton: {
    height: '30px',
    padding: '0 10px',
    border: 'none',
    borderRadius: '7px',
    background: 'transparent',
    color: '#50515b',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  menuButtonActive: {
    background: '#ffffff',
    color: '#23262e',
    boxShadow: 'inset 0 0 0 1px #d5d8de',
  },
  menuPanel: {
    position: 'absolute',
    top: '36px',
    left: 0,
    minWidth: '220px',
    padding: '8px',
    borderRadius: '12px',
    border: '1px solid #d5d8de',
    background: '#fcfcfd',
    boxShadow: '0 14px 40px rgba(15, 23, 42, 0.14)',
    display: 'grid',
    gap: '4px',
  },
  menuItem: {
    minHeight: '34px',
    padding: '8px 10px',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: '#2c3240',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    textAlign: 'left',
    fontSize: '13px',
    fontWeight: '600',
  },
  menuItemDisabled: {
    color: '#9ba3af',
    cursor: 'not-allowed',
  },
  menuItemLabel: {
    whiteSpace: 'nowrap',
  },
  menuShortcut: {
    color: '#768092',
    fontSize: '11px',
    fontWeight: '700',
    letterSpacing: '0.03em',
    whiteSpace: 'nowrap',
  },
  menuSeparator: {
    height: '1px',
    margin: '4px 2px',
    background: '#e4e7ec',
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
