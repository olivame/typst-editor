import { useEffect, useEffectEvent, useState } from 'react'
import EditorToolbar from './components/EditorToolbar'
import FileSidebar from './components/FileSidebar'
import PdfPreview from './components/PdfPreview'
import {
  compileProject,
  getFileContent,
  getProjectPdfDownloadUrl,
  getProjectPdfPreviewUrl,
  listProjectFiles,
  updateFileContent,
} from './services/projects'

export default function Editor({ projectId, onBack }) {
  const [files, setFiles] = useState([])
  const [currentFile, setCurrentFile] = useState(null)
  const [content, setContent] = useState('')
  const [compileResult, setCompileResult] = useState('')
  const [pdfVersion, setPdfVersion] = useState(null)

  async function loadFile(fileId) {
    const data = await getFileContent(fileId)
    setCurrentFile(data)
    setContent(data.content)
  }

  useEffect(() => {
    listProjectFiles(projectId).then((data) => {
        setFiles(data)
        if (data.length > 0) loadFile(data[0].id)
      })
  }, [projectId])

  async function saveFile() {
    if (!currentFile) return
    await updateFileContent(currentFile.id, content)
    setCompileResult('✓ Saved')
    setTimeout(() => setCompileResult(''), 2000)
  }

  const handleSaveShortcut = useEffectEvent(() => {
    saveFile()
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

  async function compile() {
    setCompileResult('Compiling...')
    const data = await compileProject(projectId)
    if (data.status === 'success') {
      setCompileResult(data.message || data.status)
      setPdfVersion(Date.now())
      setTimeout(() => setCompileResult(''), 3000)
      return
    }

    setCompileResult(data.message || data.status)
  }

  const previewUrl = pdfVersion ? getProjectPdfPreviewUrl(projectId, pdfVersion) : ''
  const downloadUrl = pdfVersion ? getProjectPdfDownloadUrl(projectId, pdfVersion) : ''

  return (
    <div style={styles.container}>
      <EditorToolbar
        compileResult={compileResult}
        downloadUrl={downloadUrl}
        onBack={onBack}
        onCompile={compile}
        onSave={saveFile}
      />
      <div style={styles.main}>
        <FileSidebar currentFileId={currentFile?.id} files={files} onSelectFile={loadFile} />
        <div style={styles.editor}>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            style={styles.textarea}
            spellCheck={false}
          />
        </div>
        <div style={styles.preview}>
          {previewUrl ? (
            <PdfPreview key={previewUrl} src={previewUrl} />
          ) : (
            <div style={styles.previewPlaceholder}>Compile to preview PDF</div>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#eff0f3' },
  main: { flex: 1, display: 'flex', overflow: 'hidden' },
  editor: { flex: 1, background: '#fff', margin: '12px', borderRadius: '6px', border: '1px solid #d0d0d0', overflow: 'hidden' },
  textarea: { width: '100%', height: '100%', padding: '20px', border: 'none', outline: 'none', fontFamily: 'Monaco, Menlo, monospace', fontSize: '14px', lineHeight: '1.6', resize: 'none' },
  preview: { flex: 1, background: '#d1d5db', margin: '12px 12px 12px 0', borderRadius: '6px', border: '1px solid #b8bec7', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  previewPlaceholder: { color: '#5a5a5a', fontSize: '14px' }
}
