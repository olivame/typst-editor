import { useState } from 'react'
import ProjectList from './ProjectList'
import Editor from './Editor'

function App() {
  const [currentProject, setCurrentProject] = useState(null)
  const [projectListIntentNonce, setProjectListIntentNonce] = useState(0)

  return currentProject ? (
    <Editor
      onBack={() => setCurrentProject(null)}
      onRequestNewProject={() => {
        setProjectListIntentNonce((current) => current + 1)
        setCurrentProject(null)
      }}
      projectId={currentProject}
    />
  ) : (
    <ProjectList
      newProjectIntentNonce={projectListIntentNonce}
      onOpenProject={setCurrentProject}
    />
  )
}

export default App
