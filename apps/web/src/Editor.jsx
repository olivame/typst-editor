import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import EditorToolbar from './components/EditorToolbar'
import FileSidebar from './components/FileSidebar'
import SearchSidebar from './components/SearchSidebar'
import TinymistPreview from './components/TinymistPreview'
import {
  createProjectFile,
  createProjectFolder,
  downloadProjectPdf,
  getFileContent,
  getProjectPreviewUrl,
  listProjectFiles,
  searchProjectFiles,
  updateFileContent,
  uploadProjectFiles,
} from './services/projects'

const RAIL_ITEMS = [
  { id: 'files', label: '≡', title: 'Files' },
  { id: 'search', label: '⌕', title: 'Search' },
  { id: 'outline', label: '☷', title: 'Outline' },
  { id: 'errors', label: '!', title: 'Diagnostics' },
  { id: 'settings', label: '⚙', title: 'Settings' },
]

const EDITOR_TOOL_ITEMS = ['T', 'B', 'I', 'U', 'H', '≣', 'Σ', '@']
const PREVIEW_ZOOM_FACTORS = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
  1.1, 1.3, 1.5, 1.7, 1.9, 2.1, 2.4, 2.7,
  3, 3.3, 3.7, 4.1, 4.6, 5.1, 5.7, 6.3, 7, 7.7, 8.5, 9.4, 10,
]

function findNearestPreviewZoom(value) {
  return PREVIEW_ZOOM_FACTORS.reduce((nearest, factor) => (
    Math.abs(factor - value) < Math.abs(nearest - value) ? factor : nearest
  ), PREVIEW_ZOOM_FACTORS[0])
}

function getAdjacentPreviewZoom(current, direction) {
  const nearest = findNearestPreviewZoom(current)
  const currentIndex = PREVIEW_ZOOM_FACTORS.findIndex((factor) => factor === nearest)
  if (currentIndex === -1) return 1
  if (direction > 0) {
    return PREVIEW_ZOOM_FACTORS[Math.min(currentIndex + 1, PREVIEW_ZOOM_FACTORS.length - 1)]
  }
  if (direction < 0) {
    return PREVIEW_ZOOM_FACTORS[Math.max(currentIndex - 1, 0)]
  }
  return nearest
}

function getSelectionOffset(content, line, character) {
  const lines = content.split('\n')
  const boundedLine = Math.max(0, Math.min(line, lines.length - 1))
  const offsetBeforeLine = lines
    .slice(0, boundedLine)
    .reduce((total, currentLine) => total + currentLine.length + 1, 0)
  const boundedCharacter = Math.max(0, Math.min(character, lines[boundedLine]?.length ?? 0))
  return offsetBeforeLine + boundedCharacter
}

function normalizePreviewFilePath(filepath, projectId) {
  const projectMarker = `/workspace/projects/${projectId}/`
  if (filepath.includes(projectMarker)) {
    return filepath.split(projectMarker)[1]
  }

  return filepath.split('/').filter(Boolean).slice(-1)[0] || filepath
}

export default function Editor({ projectId, onBack }) {
  const gutterRef = useRef(null)
  const textareaRef = useRef(null)
  const statusTimerRef = useRef(null)
  const pendingCursorJumpRef = useRef(null)
  const dragStateRef = useRef(null)
  const previewApiRef = useRef(null)
  const [files, setFiles] = useState([])
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [currentFile, setCurrentFile] = useState(null)
  const [content, setContent] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [sidebarMode, setSidebarMode] = useState('files')
  const [previewZoom, setPreviewZoom] = useState(1)
  const [isPreviewDetached, setIsPreviewDetached] = useState(false)
  const [previewWheelElement, setPreviewWheelElement] = useState(null)
  const [floatingPreviewPosition, setFloatingPreviewPosition] = useState({ top: 88, right: 28 })
  const [jumpNonce, setJumpNonce] = useState(0)

  function showStatus(message, duration = 0) {
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current)
      statusTimerRef.current = null
    }

    setStatusMessage(message)

    if (duration > 0) {
      statusTimerRef.current = window.setTimeout(() => {
        setStatusMessage('')
        statusTimerRef.current = null
      }, duration)
    }
  }

  async function selectEntry(entry) {
    setSelectedEntry(entry)

    if (entry.kind === 'folder' || entry.is_binary) {
      setCurrentFile(null)
      setContent('')
      return
    }

    const data = await getFileContent(entry.id)
    setCurrentFile(data)
    setContent(data.content)
  }

  async function refreshFiles(preferredPath = '') {
    const nextFiles = await listProjectFiles(projectId)
    setFiles(nextFiles)

    const nextSelectedEntry = preferredPath
      ? nextFiles.find((entry) => entry.path === preferredPath)
      : nextFiles.find((entry) => entry.path === selectedEntry?.path)

    const fallbackEntry =
      nextSelectedEntry ||
      nextFiles.find((entry) => entry.path === 'main.typ') ||
      nextFiles.find((entry) => entry.kind === 'file') ||
      nextFiles[0] ||
      null

    if (!fallbackEntry) {
      setSelectedEntry(null)
      setCurrentFile(null)
      setContent('')
      return
    }

    await selectEntry(fallbackEntry)
  }

  useEffect(() => {
    let isCancelled = false

    async function loadInitialFiles() {
      const nextFiles = await listProjectFiles(projectId)
      if (isCancelled) return

      setFiles(nextFiles)

      const fallbackEntry =
        nextFiles.find((entry) => entry.path === 'main.typ') ||
        nextFiles.find((entry) => entry.kind === 'file') ||
        nextFiles[0] ||
        null

      if (!fallbackEntry) {
        setSelectedEntry(null)
        setCurrentFile(null)
        setContent('')
        return
      }

      setSelectedEntry(fallbackEntry)

      if (fallbackEntry.kind === 'folder' || fallbackEntry.is_binary) {
        setCurrentFile(null)
        setContent('')
        return
      }

      const data = await getFileContent(fallbackEntry.id)
      if (isCancelled) return

      setCurrentFile(data)
      setContent(data.content)
    }

    void loadInitialFiles()

    return () => {
      isCancelled = true
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current)
      }
    }
  }, [projectId])

  async function saveAndPreview() {
    if (!currentFile) return
    try {
      showStatus('Saving...')
      await updateFileContent(currentFile.id, content)
      setCurrentFile((current) => (current ? { ...current, content } : current))
      showStatus('Saved', 3000)
    } catch (error) {
      showStatus(error.message || 'Failed to save')
    }
  }

  const handleSaveShortcut = useEffectEvent(() => {
    void saveAndPreview()
  })

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSaveShortcut()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  async function handleCreateFile(path) {
    const entry = await createProjectFile(projectId, path)
    await refreshFiles(entry.path)
    showStatus(`Created ${entry.path}`, 2000)
  }

  async function handleCreateFolder(path) {
    const entry = await createProjectFolder(projectId, path)
    await refreshFiles(entry.path)
    showStatus(`Created ${entry.path}`, 2000)
  }

  async function handleUploadFiles(uploadFiles, options) {
    await uploadProjectFiles(projectId, uploadFiles, options)
    const preferredPath = options.parentPath || selectedEntry?.path || ''
    await refreshFiles(preferredPath)
    showStatus(`Uploaded ${uploadFiles.length} file${uploadFiles.length > 1 ? 's' : ''}`, 2500)
  }

  async function handleSearch(query) {
    return searchProjectFiles(projectId, query)
  }

  async function handleOpenSearchResult(result) {
    const matchingEntry = files.find((entry) => entry.id === result.file_id)
    if (!matchingEntry) return
    pendingCursorJumpRef.current = {
      fileId: result.file_id,
      start: result.start,
      end: result.end,
      lineNumber: result.line_number,
    }
    await selectEntry(matchingEntry)
  }

  async function handlePreviewJump(message) {
    const filepath = message?.filepath
    const start = Array.isArray(message?.start) ? message.start : null
    const end = Array.isArray(message?.end) ? message.end : start
    if (!filepath || !start || !end) return

    const relativePath = normalizePreviewFilePath(filepath, projectId)
    const matchingEntry = files.find((entry) => entry.path === relativePath)
    if (!matchingEntry || matchingEntry.kind !== 'file' || matchingEntry.is_binary) return

    pendingCursorJumpRef.current = {
      path: relativePath,
      startLine: start[0],
      startCharacter: start[1],
      endLine: end[0],
      endCharacter: end[1],
    }
    setJumpNonce((current) => current + 1)

    if (currentFile?.path === relativePath) {
      return
    }

    await selectEntry(matchingEntry)
  }

  function handleEditorDoubleClick() {
    const textarea = textareaRef.current
    if (!textarea || !currentFile) return

    const cursor = textarea.selectionStart
    const lineStart = textarea.value.lastIndexOf('\n', Math.max(cursor - 1, 0)) + 1
    const lineNumber = textarea.value.slice(0, cursor).split('\n').length - 1
    const character = cursor - lineStart
    previewApiRef.current?.revealCursor({
      path: currentFile.path,
      line: lineNumber,
      character,
    })
  }

  useEffect(() => {
    const pendingCursorJump = pendingCursorJumpRef.current
    if (!pendingCursorJump || !currentFile || !textareaRef.current) {
      return
    }

    const matchesSearchJump =
      pendingCursorJump.fileId != null && currentFile.id === pendingCursorJump.fileId
    const matchesPreviewJump =
      pendingCursorJump.path != null && currentFile.path === pendingCursorJump.path

    if (!matchesSearchJump && !matchesPreviewJump) {
      return
    }

    const selectionStart = matchesPreviewJump
      ? getSelectionOffset(content, pendingCursorJump.startLine, pendingCursorJump.startCharacter)
      : getSelectionOffset(content, Math.max(pendingCursorJump.lineNumber - 1, 0), pendingCursorJump.start)
    const selectionEnd = matchesPreviewJump
      ? getSelectionOffset(content, pendingCursorJump.endLine, pendingCursorJump.endCharacter)
      : getSelectionOffset(content, Math.max(pendingCursorJump.lineNumber - 1, 0), pendingCursorJump.end)
    const textarea = textareaRef.current

    textarea.focus()
    textarea.setSelectionRange(selectionStart, selectionEnd)

    const lineHeight = 24
    const lineNumber = matchesPreviewJump ? pendingCursorJump.startLine + 1 : pendingCursorJump.lineNumber
    const scrollTop = Math.max((lineNumber - 3) * lineHeight, 0)
    textarea.scrollTop = scrollTop
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop
    }

    previewApiRef.current?.revealCursor({
      path: currentFile.path,
      line: matchesPreviewJump ? pendingCursorJump.startLine : Math.max(pendingCursorJump.lineNumber - 1, 0),
      character: matchesPreviewJump ? pendingCursorJump.startCharacter : pendingCursorJump.start,
    })

    pendingCursorJumpRef.current = null
  }, [content, currentFile, jumpNonce])

  async function handleDownload() {
    try {
      showStatus('Exporting PDF...')
      await downloadProjectPdf(projectId)
      showStatus('PDF exported', 3000)
    } catch (error) {
      showStatus(error.message || 'Failed to export PDF')
    }
  }

  function changePreviewZoom(delta) {
    setPreviewZoom((current) => getAdjacentPreviewZoom(current, delta))
  }

  function resetPreviewZoom() {
    setPreviewZoom(1)
  }

  function handlePreviewZoomChange(nextZoom) {
    setPreviewZoom(findNearestPreviewZoom(nextZoom))
  }

  const handlePreviewWheel = useEffectEvent((event) => {
    if (!event.ctrlKey && !event.metaKey) return

    event.preventDefault()
    changePreviewZoom(event.deltaY < 0 ? 1 : -1)
  })

  useEffect(() => {
    if (!previewWheelElement) return undefined

    const handleNativeWheel = (event) => {
      handlePreviewWheel(event)
    }

    previewWheelElement.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => {
      previewWheelElement.removeEventListener('wheel', handleNativeWheel)
    }
  }, [previewWheelElement])

  useEffect(() => {
    if (!isPreviewDetached) {
      dragStateRef.current = null
      return undefined
    }

    const handleMouseMove = (event) => {
      const dragState = dragStateRef.current
      if (!dragState) return

      setFloatingPreviewPosition({
        top: Math.max(event.clientY - dragState.offsetY, 64),
        right: Math.max(window.innerWidth - event.clientX - dragState.offsetRight, 20),
      })
    }

    const handleMouseUp = () => {
      dragStateRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isPreviewDetached])

  const lineCount = useMemo(
    () => Math.max(content.split('\n').length, 1),
    [content],
  )
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1),
    [lineCount],
  )

  const previewUrl = getProjectPreviewUrl(projectId)
  const currentPathLabel = currentFile?.path || selectedEntry?.path || 'Typst Playground'
  const currentEntryName = selectedEntry?.name || 'Welcome'
  const previewZoomLabel = `${Math.round(previewZoom * 100)}%`

  const togglePreviewDetach = () => {
    setIsPreviewDetached((current) => !current)
  }

  const startFloatingPreviewDrag = (event) => {
    dragStateRef.current = {
      offsetY: event.clientY - floatingPreviewPosition.top,
      offsetRight: window.innerWidth - event.clientX - floatingPreviewPosition.right,
    }
  }

  const renderPreviewTools = () => (
    <div style={styles.panelTools}>
      <button onClick={resetPreviewZoom} style={styles.previewChip}>⟲</button>
      <button onClick={() => changePreviewZoom(-1)} style={styles.previewChip}>−</button>
      <button style={styles.previewChipLabel}>{previewZoomLabel}</button>
      <button onClick={() => changePreviewZoom(1)} style={styles.previewChip}>+</button>
      <button
        onClick={togglePreviewDetach}
        style={styles.previewChip}
        title={isPreviewDetached ? 'Dock preview' : 'Open floating preview'}
      >
        {isPreviewDetached ? '⇲' : '⧉'}
      </button>
    </div>
  )

  const renderPreviewViewport = () => (
    <div ref={setPreviewWheelElement} style={styles.previewFrame}>
      <TinymistPreview
        ref={previewApiRef}
        key={`${projectId}-${isPreviewDetached ? 'floating' : 'embedded'}`}
        onJumpToSource={handlePreviewJump}
        onZoomChange={handlePreviewZoomChange}
        src={previewUrl}
        zoom={previewZoom}
      />
    </div>
  )

  const handleRailClick = (itemId) => {
    if (itemId === 'files') {
      setSidebarMode((current) => (current === 'files' ? '' : 'files'))
      return
    }

    if (itemId === 'search') {
      setSidebarMode((current) => (current === 'search' ? '' : 'search'))
      return
    }
  }

  return (
    <div style={styles.appShell}>
      <div style={styles.workspace}>
        <div style={styles.leftRail}>
          <div style={styles.leftRailTop}>
            <div style={styles.brandMark}>t</div>
            {RAIL_ITEMS.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  handleRailClick(item.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleRailClick(item.id)
                  }
                }}
                role="button"
                style={{
                  ...styles.railButton,
                  ...((item.id === 'files' && sidebarMode === 'files') ? styles.railButtonActive : null),
                  ...((item.id === 'search' && sidebarMode === 'search') ? styles.railButtonActive : null),
                }}
                tabIndex={0}
                title={item.title}
              >
                {item.label}
              </div>
            ))}
          </div>
          <div style={styles.leftRailBottom}>typst</div>
        </div>

        {sidebarMode === 'files' ? (
          <FileSidebar
            entries={files}
            onClose={() => setSidebarMode('')}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onSelectEntry={selectEntry}
            onUploadFiles={handleUploadFiles}
            selectedEntry={selectedEntry}
          />
        ) : null}

        {sidebarMode === 'search' ? (
          <SearchSidebar
            onClose={() => setSidebarMode('')}
            onOpenResult={handleOpenSearchResult}
            onSearch={handleSearch}
          />
        ) : null}

        <div style={styles.mainStage}>
          <EditorToolbar
            compileResult={statusMessage}
            currentPath={currentPathLabel}
            onBack={onBack}
            onDownload={handleDownload}
            onSavePreview={saveAndPreview}
          />

          <div style={styles.contentRow}>
            <section style={{ ...styles.editorColumn, ...(isPreviewDetached ? styles.editorColumnExpanded : null) }}>
              <div style={styles.panelToolbar}>
                <div style={styles.panelTools}>
                  {EDITOR_TOOL_ITEMS.map((item) => (
                    <button key={item} style={styles.toolChip}>{item}</button>
                  ))}
                </div>
                <div style={styles.panelMeta}>{currentEntryName}</div>
              </div>

              <div style={styles.editorSurface}>
                {selectedEntry?.kind === 'folder' ? (
                  <div style={styles.centerPlaceholder}>
                    Folder selected. New files and uploads will be created in
                    <strong style={styles.placeholderStrong}> {selectedEntry.path}</strong>.
                  </div>
                ) : selectedEntry?.is_binary ? (
                  <div style={styles.centerPlaceholder}>
                    This asset is part of the project workspace. It can be referenced by Typst,
                    but it is not editable in the browser.
                  </div>
                ) : (
                  <div style={styles.codeFrame}>
                    <div ref={gutterRef} style={styles.lineGutter}>
                      {lineNumbers.map((lineNumber) => (
                        <div key={lineNumber} style={styles.lineNumber}>{lineNumber}</div>
                      ))}
                    </div>
                    <textarea
                      ref={textareaRef}
                      onChange={(event) => setContent(event.target.value)}
                      onDoubleClick={handleEditorDoubleClick}
                      onScroll={(event) => {
                        if (gutterRef.current) {
                          gutterRef.current.scrollTop = event.currentTarget.scrollTop
                        }
                      }}
                      spellCheck={false}
                      style={styles.textarea}
                      value={content}
                    />
                  </div>
                )}
              </div>
            </section>

            {!isPreviewDetached ? (
              <section style={styles.previewColumn}>
                <div style={styles.panelToolbar}>
                  {renderPreviewTools()}
                  <div style={styles.panelMeta}>Preview</div>
                </div>

                {renderPreviewViewport()}
              </section>
            ) : null}
          </div>
        </div>

        {isPreviewDetached ? (
          <div
            style={{
              ...styles.floatingPreviewWindow,
              top: `${floatingPreviewPosition.top}px`,
              right: `${floatingPreviewPosition.right}px`,
            }}
          >
            <div
              onMouseDown={startFloatingPreviewDrag}
              style={{ ...styles.panelToolbar, ...styles.floatingPreviewHeader }}
            >
              {renderPreviewTools()}
              <div style={styles.floatingPreviewMeta}>
                <span style={styles.floatingDragHandle}>⋮⋮</span>
                Preview
              </div>
            </div>

            {renderPreviewViewport()}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const styles = {
  appShell: {
    height: '100vh',
    background: '#d9d9dd',
    padding: '0',
    color: '#242730',
    fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
  },
  workspace: {
    display: 'flex',
    height: '100%',
    width: '100%',
    background: '#d9d9dd',
  },
  leftRail: {
    width: '56px',
    background: '#f2f2f4',
    borderRight: '1px solid #d1d3d9',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 0 18px',
  },
  leftRailTop: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
  brandMark: {
    width: '32px',
    height: '32px',
    borderRadius: '10px',
    background: '#dcebfb',
    color: '#3f87ce',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: '800',
    marginBottom: '8px',
  },
  railButton: {
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    background: 'transparent',
    color: '#5a606a',
    cursor: 'pointer',
    fontSize: '17px',
    fontWeight: '700',
    outline: 'none',
    boxShadow: 'none',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  },
  railButtonActive: {
    background: '#ffffff',
    color: '#22262f',
    boxShadow: '0 6px 14px rgba(71, 85, 105, 0.08), inset 0 0 0 1px #ced2d9',
  },
  leftRailBottom: {
    writingMode: 'vertical-rl',
    transform: 'rotate(180deg)',
    fontSize: '20px',
    fontWeight: '800',
    letterSpacing: '0.08em',
    color: '#2f3340',
    textTransform: 'lowercase',
  },
  mainStage: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  contentRow: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    padding: '14px',
    minHeight: 0,
  },
  editorColumn: {
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #d3d5da',
    background: '#f7f7f9',
  },
  editorColumnExpanded: {
    gridColumn: '1 / -1',
  },
  previewColumn: {
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #d3d5da',
    background: '#f7f7f9',
  },
  panelToolbar: {
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '0 14px',
    background: '#efeff2',
    borderBottom: '1px solid #dadce2',
  },
  panelTools: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  toolChip: {
    minWidth: '30px',
    height: '30px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid #cbced6',
    background: '#ffffff',
    color: '#404552',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '700',
    outline: 'none',
  },
  previewChip: {
    minWidth: '30px',
    height: '30px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid #cbced6',
    background: '#ffffff',
    color: '#404552',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    outline: 'none',
  },
  previewChipLabel: {
    minWidth: '52px',
    height: '30px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid #cbced6',
    background: '#ffffff',
    color: '#404552',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'default',
  },
  panelMeta: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#646b78',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  editorSurface: {
    flex: 1,
    minHeight: 0,
    background: '#fbfbfc',
  },
  codeFrame: {
    height: '100%',
    display: 'grid',
    gridTemplateColumns: '52px 1fr',
    background: '#fbfbfc',
  },
  lineGutter: {
    overflow: 'hidden',
    background: '#f1f2f5',
    borderRight: '1px solid #e2e4ea',
    padding: '14px 0',
    textAlign: 'right',
  },
  lineNumber: {
    height: '24px',
    padding: '0 12px 0 0',
    color: '#b1b6c2',
    fontSize: '13px',
    lineHeight: '24px',
    fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
  },
  textarea: {
    width: '100%',
    height: '100%',
    border: 'none',
    resize: 'none',
    outline: 'none',
    background: '#fbfbfc',
    color: '#2b2f37',
    padding: '14px 18px',
    fontSize: '15px',
    lineHeight: '24px',
    fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
    tabSize: 2,
  },
  centerPlaceholder: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '36px',
    color: '#6b7280',
    fontSize: '14px',
    lineHeight: '1.8',
  },
  placeholderStrong: {
    color: '#2c3b4c',
  },
  previewFrame: {
    display: 'flex',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    background: '#d7d7dc',
    overflow: 'hidden',
  },
  previewPlaceholder: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666a73',
    fontSize: '14px',
    letterSpacing: '0.02em',
  },
  floatingPreviewWindow: {
    position: 'fixed',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    width: 'min(560px, calc(100vw - 96px))',
    height: 'calc(100vh - 128px)',
    minHeight: '420px',
    borderRadius: '16px',
    overflow: 'hidden',
    border: '1px solid #cfd4dd',
    background: '#f7f7f9',
    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.24)',
    zIndex: 40,
  },
  floatingPreviewHeader: {
    flexShrink: 0,
    cursor: 'move',
    userSelect: 'none',
  },
  floatingPreviewMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    fontWeight: '700',
    color: '#646b78',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  floatingDragHandle: {
    color: '#94a3b8',
    fontSize: '14px',
    letterSpacing: '-0.1em',
  },
}
