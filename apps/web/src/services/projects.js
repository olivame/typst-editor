import { API_URL } from '../config/api'

async function parseJsonResponse(response) {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return response.json()
}

export async function listProjects() {
  const response = await fetch(`${API_URL}/projects`)
  return parseJsonResponse(response)
}

export async function createProject(name) {
  const response = await fetch(`${API_URL}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })

  return parseJsonResponse(response)
}

export async function copyProject(projectId) {
  const response = await fetch(`${API_URL}/projects/${projectId}/copy`, {
    method: 'POST',
  })

  return parseJsonResponse(response)
}

export async function deleteProject(projectId) {
  const response = await fetch(`${API_URL}/projects/${projectId}`, {
    method: 'DELETE',
  })

  return parseJsonResponse(response)
}

export async function updateProjectStatus(projectId, status) {
  const response = await fetch(`${API_URL}/projects/${projectId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })

  return parseJsonResponse(response)
}

export async function listProjectFiles(projectId) {
  const response = await fetch(`${API_URL}/projects/${projectId}/files`)
  return parseJsonResponse(response)
}

export async function searchProjectFiles(projectId, query) {
  const response = await fetch(
    `${API_URL}/projects/${projectId}/search?q=${encodeURIComponent(query)}`,
  )
  return parseJsonResponse(response)
}

export async function createProjectFile(projectId, path) {
  const response = await fetch(`${API_URL}/projects/${projectId}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })

  return parseJsonResponse(response)
}

export async function createProjectFolder(projectId, path) {
  const response = await fetch(`${API_URL}/projects/${projectId}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })

  return parseJsonResponse(response)
}

export async function uploadProjectFiles(projectId, files, options = {}) {
  const formData = new FormData()
  const relativePaths = options.relativePaths || []

  files.forEach((file) => {
    formData.append('files', file, file.name)
  })

  formData.append('parent_path', options.parentPath || '')
  if (relativePaths.length > 0) {
    formData.append('relative_paths', JSON.stringify(relativePaths))
  }

  const response = await fetch(`${API_URL}/projects/${projectId}/uploads`, {
    method: 'POST',
    body: formData,
  })

  return parseJsonResponse(response)
}

export async function getFileContent(fileId) {
  const response = await fetch(`${API_URL}/files/${fileId}/content`)
  return parseJsonResponse(response)
}

export async function updateFileContent(fileId, content) {
  const response = await fetch(`${API_URL}/files/${fileId}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })

  return parseJsonResponse(response)
}

export async function compileProject(projectId) {
  const response = await fetch(`${API_URL}/projects/${projectId}/compile`, {
    method: 'POST',
  })

  return parseJsonResponse(response)
}

export function getProjectPdfPreviewUrl(projectId, version) {
  return `${API_URL}/projects/${projectId}/pdf?t=${version}`
}

export function getProjectPdfDownloadUrl(projectId, version) {
  return `${API_URL}/projects/${projectId}/pdf/download?t=${version}`
}
