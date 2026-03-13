import { API_URL } from '../config/api'
import { PREVIEW_URL } from '../config/preview'

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

export async function renameProjectEntry(fileId, path) {
  const response = await fetch(`${API_URL}/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })

  return parseJsonResponse(response)
}

export async function deleteProjectEntry(fileId) {
  const response = await fetch(`${API_URL}/files/${fileId}`, {
    method: 'DELETE',
  })

  return parseJsonResponse(response)
}

export async function compileProject(projectId, options = {}) {
  const response = await fetch(`${API_URL}/projects/${projectId}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entrypoint: options.entrypoint || '' }),
  })

  return parseJsonResponse(response)
}

export async function listAvailableFonts() {
  const response = await fetch(`${API_URL}/fonts`)
  return parseJsonResponse(response)
}

export function getProjectPreviewUrl(projectId, options = {}) {
  const url = new URL(`${PREVIEW_URL}/sessions/${projectId}/data`)
  if (options.entrypoint) {
    url.searchParams.set('entrypoint', options.entrypoint)
  }
  return url.toString()
}

export function getProjectFileUrl(fileId, options = {}) {
  const url = new URL(`${API_URL}/files/${fileId}/raw`)
  if (options.download) {
    url.searchParams.set('download', '1')
  }
  return url.toString()
}

export async function getProjectPreviewStatus(projectId, options = {}) {
  const url = new URL(`${PREVIEW_URL}/sessions/${projectId}/status`)
  if (options.entrypoint) {
    url.searchParams.set('entrypoint', options.entrypoint)
  }
  const response = await fetch(url)
  return parseJsonResponse(response)
}

export async function downloadProjectPdf(projectId, options = {}) {
  const url = new URL(`${API_URL}/projects/${projectId}/pdf/download`)
  if (options.entrypoint) {
    url.searchParams.set('entrypoint', options.entrypoint)
  }
  const response = await fetch(url)
  if (!response.ok) {
    const message = await response.text()
    try {
      const payload = JSON.parse(message)
      throw new Error(payload.detail || 'Failed to export PDF')
    } catch {
      throw new Error(message || 'Failed to export PDF')
    }
  }

  const blob = await response.blob()
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = options.filename || 'main.pdf'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(objectUrl)
}

export function downloadProjectFile(fileId, filename = '') {
  const anchor = document.createElement('a')
  anchor.href = getProjectFileUrl(fileId, { download: true })
  if (filename) {
    anchor.download = filename
  }
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
