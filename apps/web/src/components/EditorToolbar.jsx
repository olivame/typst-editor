export default function EditorToolbar({
  compileResult,
  downloadUrl,
  onBack,
  onCompile,
  onSave,
}) {
  return (
    <div style={styles.toolbar}>
      <button onClick={onBack} style={styles.backBtn}>← Projects</button>
      <div style={styles.toolbarRight}>
        <button onClick={onSave} style={styles.toolBtn}>Save</button>
        <button onClick={onCompile} style={styles.compileBtn}>Compile</button>
        {downloadUrl && <a href={downloadUrl} style={styles.downloadBtn}>Download PDF</a>}
        {compileResult && <span style={styles.status}>{compileResult}</span>}
      </div>
    </div>
  )
}

const styles = {
  toolbar: { background: '#fff', padding: '12px 20px', borderBottom: '1px solid #d0d0d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  backBtn: { padding: '8px 16px', background: '#fff', border: '1px solid #d0d0d0', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' },
  toolbarRight: { display: 'flex', gap: '12px', alignItems: 'center' },
  toolBtn: { padding: '8px 16px', background: '#fff', border: '1px solid #d0d0d0', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' },
  compileBtn: { padding: '8px 16px', background: '#239dad', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' },
  downloadBtn: { padding: '8px 16px', background: '#239dad', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', textDecoration: 'none' },
  status: { fontSize: '14px', color: '#5a5a5a' },
}
