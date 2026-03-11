import { useMemo, useRef, useState } from 'react'

function getParentPath(path) {
  if (!path || !path.includes('/')) return ''
  return path.split('/').slice(0, -1).join('/')
}

function joinPath(parentPath, childName) {
  return parentPath ? `${parentPath}/${childName}` : childName
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

function getIconForNode(node) {
  if (node.kind === 'folder') return '▸'
  if (node.is_binary) return '◫'
  return '≡'
}

function renderTree({
  activePath,
  collapsedFolders,
  depth = 0,
  nodes,
  onSelectEntry,
  onToggleFolder,
}) {
  return sortNodes(nodes).map((node) => {
    const isFolder = node.kind === 'folder'
    const isCollapsed = Boolean(collapsedFolders[node.path])
    const isActive = activePath === node.path

    return (
      <div key={node.path}>
        <div
          onClick={() => onSelectEntry(node)}
          style={{
            ...styles.treeItem,
            ...(isActive ? styles.treeItemActive : null),
            paddingLeft: `${12 + depth * 18}px`,
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
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <span style={styles.nodeIcon}>{getIconForNode(node)}</span>
          <span style={styles.treeLabel}>{node.name}</span>
          {node.is_binary ? <span style={styles.assetTag}>asset</span> : null}
          {isActive ? <span style={styles.moreGlyph}>⋮</span> : null}
        </div>
        {isFolder && !isCollapsed ? renderTree({
          activePath,
          collapsedFolders,
          depth: depth + 1,
          nodes: node.children,
          onSelectEntry,
          onToggleFolder,
        }) : null}
      </div>
    )
  })
}

export default function FileSidebar({
  entries,
  onClose,
  onCreateFile,
  onCreateFolder,
  onSelectEntry,
  onUploadFiles,
  selectedEntry,
}) {
  const fileUploadRef = useRef(null)
  const folderUploadRef = useRef(null)
  const [collapsedFolders, setCollapsedFolders] = useState({})
  const [createMode, setCreateMode] = useState('')
  const [draftName, setDraftName] = useState('')
  const [actionError, setActionError] = useState('')

  const tree = useMemo(() => buildTree(entries), [entries])

  const targetDirectory = useMemo(() => {
    if (!selectedEntry) return ''
    if (selectedEntry.kind === 'folder') return selectedEntry.path
    return getParentPath(selectedEntry.path)
  }, [selectedEntry])

  const handleToggleFolder = (path) => {
    setCollapsedFolders((current) => ({
      ...current,
      [path]: !current[path],
    }))
  }

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

  return (
    <aside style={styles.sidebar}>
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
        <div style={styles.targetText}>target: {targetDirectory || 'root'}</div>
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
          collapsedFolders,
          nodes: tree,
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
    width: '282px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#f3f4f6',
    color: '#334155',
    borderRight: '1px solid #d3d8e0',
    boxShadow: 'inset -1px 0 0 rgba(255, 255, 255, 0.5)',
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
  targetText: {
    marginTop: '8px',
    paddingLeft: '30px',
    fontSize: '11px',
    color: '#64748b',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
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
    background: '#1f7a53',
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
  treeItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '34px',
    paddingRight: '12px',
    color: '#334155',
    cursor: 'pointer',
    userSelect: 'none',
    borderLeft: '2px solid transparent',
  },
  treeItemActive: {
    background: '#1f7a53',
    color: '#f8fffb',
    borderLeftColor: '#96d5b5',
  },
  expandButton: {
    width: '18px',
    height: '18px',
    border: 'none',
    background: 'transparent',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: '11px',
    padding: 0,
    outline: 'none',
  },
  nodeIcon: {
    width: '16px',
    color: '#64748b',
    fontSize: '12px',
    textAlign: 'center',
  },
  treeLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '13px',
    fontWeight: '600',
  },
  assetTag: {
    padding: '2px 6px',
    borderRadius: '999px',
    background: '#fef3c7',
    color: '#a16207',
    fontSize: '10px',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  moreGlyph: {
    width: '18px',
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: '14px',
  },
  emptyState: {
    padding: '18px',
    color: '#64748b',
    fontSize: '13px',
  },
}
