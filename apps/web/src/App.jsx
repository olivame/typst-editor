import { useState } from 'react'
import ProjectList from './ProjectList'
import Editor from './Editor'

function App() {
  const [currentProject, setCurrentProject] = useState(null)

  return currentProject ? (
    <Editor projectId={currentProject} onBack={() => setCurrentProject(null)} />
  ) : (
    <ProjectList onOpenProject={setCurrentProject} />
  )
}

export default App
