export default function FileSidebar({ currentFileId, files, onSelectFile }) {
  return (
    <div style={styles.sidebar}>
      <div style={styles.sidebarHeader}>Files</div>
      {files.map((file) => (
        <div
          key={file.id}
          onClick={() => onSelectFile(file.id)}
          style={{
            ...styles.fileItem,
            ...(currentFileId === file.id ? styles.fileItemActive : {}),
          }}
        >
          {file.name}
        </div>
      ))}
    </div>
  )
}

const styles = {
  sidebar: { width: '200px', background: '#fff', borderRight: '1px solid #d0d0d0', overflow: 'auto' },
  sidebarHeader: { padding: '16px', fontWeight: '600', fontSize: '13px', color: '#5a5a5a', borderBottom: '1px solid #d0d0d0' },
  fileItem: { padding: '10px 16px', cursor: 'pointer', fontSize: '14px', borderBottom: '1px solid #f0f0f0' },
  fileItemActive: { background: '#e5e6e9', fontWeight: '500' },
}
