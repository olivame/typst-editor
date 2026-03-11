import { useState, useEffect } from 'react'
import { createProject as createProjectRequest, listProjects } from './services/projects'

export default function ProjectList({ onOpenProject }) {
  const [projects, setProjects] = useState([])
  const [newName, setNewName] = useState('')

  useEffect(() => {
    listProjects().then(setProjects)
  }, [])

  const createProject = async () => {
    if (!newName.trim()) return
    const project = await createProjectRequest(newName)
    setProjects([...projects, project])
    setNewName('')
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Typst Projects</h1>
      </div>
      <div style={styles.content}>
        <div style={styles.createBox}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="New project name"
            style={styles.input}
            onKeyPress={e => e.key === 'Enter' && createProject()}
          />
          <button onClick={createProject} style={styles.button}>Create</button>
        </div>
        <div style={styles.projectList}>
          {projects.map(p => (
            <div key={p.id} style={styles.projectCard} onClick={() => onOpenProject(p.id)}>
              <div style={styles.projectName}>{p.name}</div>
              <div style={styles.projectDate}>{new Date(p.created_at).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    height: '100vh',
    background: '#eff0f3',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    background: '#fff',
    padding: '20px 40px',
    borderBottom: '1px solid #d0d0d0',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
  },
  title: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#191c1f',
    margin: 0
  },
  content: {
    flex: 1,
    padding: '40px',
    overflow: 'auto'
  },
  createBox: {
    display: 'flex',
    gap: '12px',
    marginBottom: '30px',
    maxWidth: '600px'
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    border: '1px solid #d0d0d0',
    borderRadius: '6px',
    fontSize: '14px',
    background: '#fff',
    outline: 'none'
  },
  button: {
    padding: '12px 24px',
    background: '#239dad',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  projectList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px'
  },
  projectCard: {
    background: '#fff',
    padding: '20px',
    borderRadius: '6px',
    border: '1px solid #d0d0d0',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
  },
  projectName: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#191c1f',
    marginBottom: '8px'
  },
  projectDate: {
    fontSize: '13px',
    color: '#5a5a5a'
  }
}
