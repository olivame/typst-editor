import { useEffect, useMemo, useRef, useState } from 'react'
import {
  APP_SIDEBAR_BACKGROUND,
  APP_SIDEBAR_BORDER,
  APP_SIDEBAR_WIDTH,
} from '../config/sidebar'
import { ensureSetiFont, getSetiFileIcon } from '../config/setiFileIcons'

function getParentPath(path) {
  if (!path || !path.includes('/')) return ''
  return path.split('/').slice(0, -1).join('/')
}

function joinPath(parentPath, childName) {
  return parentPath ? `${parentPath}/${childName}` : childName
}

function getAncestorFolderPaths(path) {
  if (!path || !path.includes('/')) return []

  const parts = path.split('/')
  const ancestors = []

  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join('/'))
  }

  return ancestors
}

function sortNodes(nodes) {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'folder' ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })
}

function buildTree(entries) {
  const root = []
  const nodeMap = new Map()

  entries.forEach((entry) => {
    const parts = entry.path.split('/')
    let children = root
    let currentPath = ''

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLeaf = index === parts.length - 1
      const existingNode = nodeMap.get(currentPath)

      if (existingNode) {
        if (isLeaf) {
          existingNode.id = entry.id
          existingNode.kind = entry.kind
          existingNode.is_binary = entry.is_binary
        }

        children = existingNode.children
        return
      }

      const nextNode = {
        id: isLeaf ? entry.id : null,
        name: part,
        path: currentPath,
        kind: isLeaf ? entry.kind : 'folder',
        is_binary: isLeaf ? entry.is_binary : false,
        children: [],
      }

      children.push(nextNode)
      nodeMap.set(currentPath, nextNode)
      children = nextNode.children
    })
  })

  return root
}

function getFolderVisual(isCollapsed) {
  return {
    type: 'folder',
    tone: '#b98724',
    accent: isCollapsed ? '#f3cf6b' : '#efb94f',
    background: isCollapsed ? '#fbf1c7' : '#f7e4ac',
  }
}

function getNodeVisual(node, isCollapsed) {
  if (node.kind === 'folder') {
    return getFolderVisual(isCollapsed)
  }

  return {
    type: 'file',
    ...getSetiFileIcon(node.name),
  }
}

function collectInitialCollapsedFolders(nodes, collapsed = {}) {
  for (const node of nodes) {
    if (node.kind !== 'folder') continue
    collapsed[node.path] = true
    collectInitialCollapsedFolders(node.children, collapsed)
  }
  return collapsed
}

function renderNodeIcon(node, isCollapsed) {
  const visual = getNodeVisual(node, isCollapsed)

  if (visual.type === 'folder') {
    return (
      <span style={styles.nodeIcon}>
        <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
          <path
            d="M1.5 4.5a1.5 1.5 0 0 1 1.5-1.5h2.2c.44 0 .85.2 1.13.53l.82.97H13a1.5 1.5 0 0 1 1.5 1.5v.2c0 .28-.22.5-.5.5H2a.5.5 0 0 0-.5.5v4.85A1.5 1.5 0 0 0 3 13.5h9.84a1.5 1.5 0 0 0 1.46-1.18l.95-4.13A1.5 1.5 0 0 0 13.79 6H7.55l-.98-1.17A1.47 1.47 0 0 0 5.43 4.3H3A1.5 1.5 0 0 0 1.5 5.8z"
            fill={visual.background}
            stroke={visual.tone}
            strokeWidth="0.8"
          />
          <path d="M1.8 6.2h12.6" stroke={visual.accent} strokeLinecap="round" strokeWidth="1" />
        </svg>
      </span>
    )
  }

  return (
    <span style={styles.nodeIcon}>
      <span
        aria-hidden="true"
        style={{
          ...styles.fileGlyph,
          color: visual.color,
        }}
      >
        {visual.character}
      </span>
    </span>
  )
}

function renderTree({
  activePath,
  collapsedFolders,
  depth = 0,
  nodes,
  menuPath,
  onDeleteEntry,
  onDownloadEntry,
  onOpenMenu,
  onRenameEntry,
  onSelectEntry,
  onToggleFolder,
}) {
  return sortNodes(nodes).map((node) => {
    const isFolder = node.kind === 'folder'
    const isCollapsed = Boolean(collapsedFolders[node.path])
    const isActive = activePath === node.path
    const isMenuOpen = menuPath === node.path
    return (
      <div key={node.path} style={styles.treeNode}>
        <div
          onClick={() => {
            if (isFolder) {
              onToggleFolder(node.path)
            }
            onSelectEntry(node)
          }}
          style={{
            ...styles.treeItem,
            ...(isActive ? styles.treeItemActive : null),
            paddingLeft: `${10 + depth * 16}px`,
          }}
        >
          <button
            onClick={(event) => {
              event.stopPropagation()
              if (isFolder) onToggleFolder(node.path)
            }}
            style={{
              ...styles.expandButton,
              visibility: isFolder ? 'visible' : 'hidden',
            }}
            type="button"
          >
            {isCollapsed ? '›' : '⌄'}
          </button>
          {renderNodeIcon(node, isCollapsed)}
          <span style={styles.treeLabel}>{node.name}</span>
          {(isActive || isMenuOpen) ? (
            <button
              onClick={(event) => {
                event.stopPropagation()
                onOpenMenu(isMenuOpen ? '' : node.path)
              }}
              style={{
                ...styles.menuTrigger,
                ...(isActive ? styles.menuTriggerActive : null),
              }}
              title="More actions"
              type="button"
            >
              ⋮
            </button>
          ) : null}
        </div>
        {isMenuOpen ? (
          <div style={styles.menuPanel}>
            <button
              onClick={() => {
                onOpenMenu('')
                onRenameEntry(node)
              }}
              style={styles.menuItem}
              type="button"
            >
              Rename
            </button>
            {!isFolder ? (
              <button
                onClick={() => {
                  onOpenMenu('')
                  onDownloadEntry(node)
                }}
                style={styles.menuItem}
                type="button"
              >
                Download
              </button>
            ) : null}
            <button
              onClick={() => {
                onOpenMenu('')
                onDeleteEntry(node)
              }}
              style={{ ...styles.menuItem, ...styles.menuItemDanger }}
              type="button"
            >
              Delete
            </button>
          </div>
        ) : null}
        {isFolder && !isCollapsed ? renderTree({
          activePath,
          collapsedFolders,
          depth: depth + 1,
          menuPath,
          nodes: node.children,
          onDeleteEntry,
          onDownloadEntry,
          onOpenMenu,
          onRenameEntry,
          onSelectEntry,
          onToggleFolder,
        }) : null}
      </div>
    )
  })
}

export default function FileSidebar({
  collapsedFolders,
  onCollapsedFoldersChange,
  entries,
  onClose,
  onCreateFile,
  onCreateFolder,
  onDeleteEntry,
  onDownloadEntry,
  onRenameEntry,
  onSelectEntry,
  onUploadFiles,
  projectId,
  selectedEntry,
}) {
  const fileUploadRef = useRef(null)
  const folderUploadRef = useRef(null)
  const sidebarRef = useRef(null)
  const [createMode, setCreateMode] = useState('')
  const [draftName, setDraftName] = useState('')
  const [actionError, setActionError] = useState('')
  const [menuPath, setMenuPath] = useState('')

  const tree = useMemo(() => buildTree(entries), [entries])
  const defaultCollapsedFolders = useMemo(() => collectInitialCollapsedFolders(tree), [tree])
  const effectiveCollapsedFolders = useMemo(() => {
    const next = {}
    Object.keys(defaultCollapsedFolders).forEach((path) => {
      next[path] = Object.prototype.hasOwnProperty.call(collapsedFolders, path)
        ? collapsedFolders[path]
        : defaultCollapsedFolders[path]
    })
    return next
  }, [collapsedFolders, defaultCollapsedFolders])

  const targetDirectory = useMemo(() => {
    if (!selectedEntry) return ''
    if (selectedEntry.kind === 'folder') return selectedEntry.path
    return getParentPath(selectedEntry.path)
  }, [selectedEntry])

  const handleToggleFolder = (path) => {
    onCollapsedFoldersChange((current) => ({
      ...current,
      [path]: !effectiveCollapsedFolders[path],
    }))
  }

  useEffect(() => {
    ensureSetiFont()
  }, [])

  useEffect(() => {
    onCollapsedFoldersChange((current) => {
      const next = {}
      Object.keys(defaultCollapsedFolders).forEach((path) => {
        next[path] = Object.prototype.hasOwnProperty.call(current, path)
          ? current[path]
          : defaultCollapsedFolders[path]
      })
      const currentKeys = Object.keys(current)
      const nextKeys = Object.keys(next)
      if (
        currentKeys.length === nextKeys.length
        && nextKeys.every((path) => current[path] === next[path])
      ) {
        return current
      }
      return next
    })
  }, [defaultCollapsedFolders, onCollapsedFoldersChange])

  useEffect(() => {
    if (!selectedEntry || selectedEntry.kind !== 'file' || selectedEntry.is_binary) return

    const ancestorPaths = getAncestorFolderPaths(selectedEntry.path)
    if (ancestorPaths.length === 0) return

    onCollapsedFoldersChange((current) => {
      let changed = false
      const next = { ...current }

      ancestorPaths.forEach((path) => {
        if (next[path] !== false) {
          next[path] = false
          changed = true
        }
      })

      return changed ? next : current
    })
  }, [onCollapsedFoldersChange, selectedEntry])

  useEffect(() => {
    setMenuPath('')
  }, [projectId])

  const openCreateForm = (mode) => {
    setCreateMode(mode)
    setDraftName('')
    setActionError('')
  }

  const closeCreateForm = () => {
    setCreateMode('')
    setDraftName('')
    setActionError('')
  }

  const openMenu = (path) => {
    setMenuPath(path)
  }

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!sidebarRef.current?.contains(event.target)) {
        setMenuPath('')
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const handleCreate = async () => {
    const trimmedName = draftName.trim()
    if (!trimmedName) {
      setActionError('Name is required')
      return
    }

    const nextPath = joinPath(targetDirectory, trimmedName)

    try {
      if (createMode === 'file') {
        await onCreateFile(nextPath)
      } else {
        await onCreateFolder(nextPath)
      }
      closeCreateForm()
    } catch (error) {
      setActionError(error.message || 'Failed to create entry')
    }
  }

  const handleUpload = async (event, includeRelativePaths) => {
    const uploadFiles = Array.from(event.target.files || [])
    event.target.value = ''

    if (uploadFiles.length === 0) return

    try {
      await onUploadFiles(uploadFiles, {
        parentPath: targetDirectory,
        relativePaths: includeRelativePaths
          ? uploadFiles.map((file) => file.webkitRelativePath || file.name)
          : [],
      })
      setActionError('')
    } catch (error) {
      setActionError(error.message || 'Failed to upload files')
    }
  }

  const handleRenameEntry = async (entry) => {
    const nextName = window.prompt('Rename to', entry.name)
    if (nextName == null) return

    const trimmedName = nextName.trim()
    if (!trimmedName) {
      setActionError('Name is required')
      return
    }

    const nextPath = joinPath(getParentPath(entry.path), trimmedName)

    try {
      await onRenameEntry(entry, nextPath)
      setActionError('')
    } catch (error) {
      setActionError(error.message || 'Failed to rename entry')
    }
  }

  const handleDeleteEntry = async (entry) => {
    const confirmed = window.confirm(
      entry.kind === 'folder'
        ? `Delete folder "${entry.path}" and all nested files?`
        : `Delete file "${entry.path}"?`,
    )
    if (!confirmed) return

    try {
      await onDeleteEntry(entry)
      setActionError('')
    } catch (error) {
      setActionError(error.message || 'Failed to delete entry')
    }
  }

  const handleDownloadEntry = (entry) => {
    try {
      onDownloadEntry(entry)
      setActionError('')
    } catch (error) {
      setActionError(error.message || 'Failed to download entry')
    }
  }

  return (
    <aside ref={sidebarRef} style={styles.sidebar}>
      <div style={styles.header}>
        <div style={styles.headerTitleRow}>
          <button onClick={onClose} style={styles.headerChevron}>▾</button>
          <div style={styles.headerTitle}>File tree</div>
          <div style={styles.headerTools}>
            <button
              onClick={() => openCreateForm('file')}
              style={styles.headerToolButton}
              title="New file"
            >
              ⧉
            </button>
            <button
              onClick={() => openCreateForm('folder')}
              style={styles.headerToolButton}
              title="New folder"
            >
              ⊞
            </button>
            <button
              onClick={() => fileUploadRef.current?.click()}
              style={styles.headerToolButton}
              title="Upload file"
            >
              ↑
            </button>
            <button onClick={onClose} style={styles.headerToolButton} title="Hide sidebar">
              ×
            </button>
          </div>
        </div>
      </div>

      {createMode ? (
        <div style={styles.createPanel}>
          <div style={styles.createPanelTitle}>
            {createMode === 'file' ? 'Create file' : 'Create folder'}
          </div>
          <input
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate()
              if (event.key === 'Escape') closeCreateForm()
            }}
            placeholder={createMode === 'file' ? 'chapter.typ' : 'assets'}
            style={styles.createInput}
            value={draftName}
          />
          <div style={styles.createActions}>
            <button onClick={() => void handleCreate()} style={styles.confirmButton}>Create</button>
            <button onClick={closeCreateForm} style={styles.cancelButton}>Cancel</button>
            <button
              onClick={() => folderUploadRef.current?.click()}
              style={styles.cancelButton}
            >
              Upload folder
            </button>
          </div>
        </div>
      ) : null}

      {actionError ? <div style={styles.errorText}>{actionError}</div> : null}

      <div style={styles.treeRoot}>
        {tree.length > 0 ? renderTree({
          activePath: selectedEntry?.path || '',
          collapsedFolders: effectiveCollapsedFolders,
          menuPath,
          nodes: tree,
          onDeleteEntry: handleDeleteEntry,
          onDownloadEntry: handleDownloadEntry,
          onOpenMenu: openMenu,
          onRenameEntry: handleRenameEntry,
          onSelectEntry,
          onToggleFolder: handleToggleFolder,
        }) : (
          <div style={styles.emptyState}>No files yet</div>
        )}
      </div>

      <input
        hidden
        multiple
        onChange={(event) => void handleUpload(event, false)}
        ref={fileUploadRef}
        type="file"
      />
      <input
        hidden
        multiple
        onChange={(event) => void handleUpload(event, true)}
        ref={folderUploadRef}
        type="file"
        webkitdirectory=""
      />
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
    boxShadow: 'inset -1px 0 0 rgba(255, 255, 255, 0.5)',
    flexShrink: 0,
  },
  header: {
    padding: '12px 10px 10px',
    borderBottom: '1px solid #d8dde6',
  },
  headerTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  headerChevron: {
    width: '22px',
    height: '22px',
    border: 'none',
    background: 'transparent',
    color: '#334155',
    cursor: 'pointer',
    fontSize: '15px',
    outline: 'none',
  },
  headerTitle: {
    flex: 1,
    fontSize: '14px',
    fontWeight: '700',
    color: '#1f2937',
  },
  headerTools: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  headerToolButton: {
    width: '28px',
    height: '28px',
    borderRadius: '7px',
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    fontSize: '13px',
    lineHeight: 1,
    outline: 'none',
  },
  createPanel: {
    margin: '10px',
    padding: '12px',
    borderRadius: '12px',
    background: '#ffffff',
    border: '1px solid #d7dde5',
  },
  createPanelTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: '8px',
  },
  createInput: {
    width: '100%',
    height: '38px',
    padding: '0 12px',
    borderRadius: '9px',
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    color: '#1f2937',
    outline: 'none',
    fontSize: '13px',
  },
  createActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px',
  },
  confirmButton: {
    height: '32px',
    padding: '0 12px',
    borderRadius: '8px',
    border: 'none',
    background: '#4f97dd',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    outline: 'none',
  },
  cancelButton: {
    height: '32px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    outline: 'none',
  },
  errorText: {
    margin: '0 10px 10px',
    padding: '10px 12px',
    borderRadius: '10px',
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: '12px',
    lineHeight: '1.5',
    wordBreak: 'break-word',
  },
  treeRoot: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 0 14px',
  },
  treeNode: {
    position: 'relative',
  },
  treeItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    minHeight: '28px',
    paddingTop: '1px',
    paddingBottom: '1px',
    paddingRight: '12px',
    color: '#334155',
    cursor: 'pointer',
    userSelect: 'none',
    borderLeft: '2px solid transparent',
  },
  treeItemActive: {
    background: '#4f97dd',
    color: '#f8fffb',
    borderLeftColor: '#b7dbfb',
  },
  expandButton: {
    width: '14px',
    height: '14px',
    border: 'none',
    background: 'transparent',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: '13px',
    lineHeight: 1,
    padding: 0,
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  nodeIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    flexShrink: 0,
  },
  fileGlyph: {
    fontFamily: 'Seti, monospace',
    fontSize: '18px',
    lineHeight: 1,
    display: 'block',
    width: '16px',
    height: '16px',
  },
  treeLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '12px',
    fontWeight: '500',
  },
  menuTrigger: {
    width: '24px',
    height: '24px',
    borderRadius: '8px',
    border: 'none',
    background: 'transparent',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: '14px',
    lineHeight: 1,
    outline: 'none',
    flexShrink: 0,
  },
  menuTriggerActive: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  menuPanel: {
    position: 'absolute',
    top: '36px',
    right: '10px',
    zIndex: 10,
    minWidth: '128px',
    padding: '6px',
    borderRadius: '12px',
    border: '1px solid #d5dbe5',
    background: '#ffffff',
    boxShadow: '0 18px 34px rgba(15, 23, 42, 0.16)',
    display: 'grid',
    gap: '4px',
  },
  menuItem: {
    height: '34px',
    padding: '0 10px',
    borderRadius: '8px',
    border: 'none',
    background: 'transparent',
    color: '#334155',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: '600',
    outline: 'none',
  },
  menuItemDanger: {
    color: '#b91c1c',
  },
  emptyState: {
    padding: '18px',
    color: '#64748b',
    fontSize: '13px',
  },
}
