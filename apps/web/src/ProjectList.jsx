import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createProject as createProjectRequest,
  createTag as createTagRequest,
  copyProject as copyProjectRequest,
  deleteProject as deleteProjectRequest,
  deleteTag as deleteTagRequest,
  listProjectFiles,
  listProjects,
  listTags,
  updateProjectTags as updateProjectTagsRequest,
  updateProjectStatus as updateProjectStatusRequest,
  updateFileContent,
} from './services/projects'

const TEMPLATE_OPTIONS = [
  {
    id: 'blank',
    label: 'Blank project',
    description: 'Start from an empty Typst document.',
    defaultName: 'Untitled Project',
    content: '= New document\n\nStart writing here.',
    enabled: true,
  },
  {
    id: 'example',
    label: 'Example project',
    description: 'Create a sample Typst file with headings and layout.',
    defaultName: 'Example Project',
    content: `#set page(paper: "a5")
#set heading(numbering: "1.")

#show link: set text(fill: blue, weight: 700)
#show link: underline

= The Typst Playground

Welcome to the Typst Playground! This is a sandbox where you can experiment with Typst. You can type anywhere in the editor panel on the left. The preview panel to the right will update live.

= Basics <basics>

Typst is a _markup_ language. You use it to express not just the content, but also the structure and formatting of your document. For example, surrounding a word with underscores _emphasizes_ it with italics and starting a line with an equals sign creates a section heading.

Typst has lightweight syntax like this for the most common formatting needs. Among other things, you can use it to:

- *Strongly emphasize* some text
- Refer to @basics
- Typeset math: $a, b in { 1/2, sqrt(4 a b) }$

That's just the surface though! Typst has powerful systems for scripting, styling, introspection, and more. In the realm of a Typst document, there is nothing you can't automate.

= Next steps

To learn more about Typst, we recommend you to check out our tutorial at https://typst.app/docs/tutorial.

Once you've explored Typst a bit, why not set yourself up a proper editing environment?

#import "@preview/tiaoma:0.3.0"
#let next-step(url, body) = grid(
  columns: 2,
  gutter: 1em,
  tiaoma.qrcode(url, width: 3em),
  {
    show strong: link.with(url)
    body
  }
)

#next-step("https://typst.app/signup")[
  To get access to multi-file projects, live collaboration, and more, *sign up* to our web app for free.
]

#next-step("https://typst.app/open-source/#download")[
  You can also *download* our free and open-source command line tool to continue your journey locally.
]
`,
    enabled: true,
  },
  {
    id: 'upload',
    label: 'Upload project',
    description: 'Coming soon.',
    defaultName: '',
    content: '',
    enabled: false,
  },
]

const SIDEBAR_ITEMS = [
  { id: 'all', label: 'All projects' },
  { id: 'your', label: 'Your projects' },
  { id: 'shared', label: 'Shared with you' },
  { id: 'archived', label: 'Archived projects' },
  { id: 'trashed', label: 'Trashed projects' },
]

function formatProjectDate(value) {
  if (!value) return 'Just now'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Just now'

  const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return '1 day ago'
  return `${diffDays} days ago`
}

export default function ProjectList({ newProjectIntentNonce = 0, onOpenProject }) {
  const actionMenuTriggerRefs = useRef({})
  const headerCheckboxRef = useRef(null)
  const [projects, setProjects] = useState([])
  const [tags, setTags] = useState([])
  const [selectedView, setSelectedView] = useState('all')
  const [selectedTagId, setSelectedTagId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [activeProjectAction, setActiveProjectAction] = useState('')
  const [selectedProjectIds, setSelectedProjectIds] = useState([])
  const [openActionMenuProjectId, setOpenActionMenuProjectId] = useState(null)
  const [actionMenuPosition, setActionMenuPosition] = useState(null)
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [confirmationModal, setConfirmationModal] = useState(null)
  const [isTagModalOpen, setIsTagModalOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [isCreatingTag, setIsCreatingTag] = useState(false)
  const [editingProjectTags, setEditingProjectTags] = useState(null)
  const [draftTagIds, setDraftTagIds] = useState([])
  const [isSavingProjectTags, setIsSavingProjectTags] = useState(false)

  useEffect(() => {
    Promise.all([listProjects(), listTags()])
      .then(([loadedProjects, loadedTags]) => {
        setProjects(loadedProjects)
        setTags(loadedTags)
      })
      .catch((error) => setErrorMessage(error.message || 'Failed to load projects'))
  }, [])

  useEffect(() => {
    const handleWindowClick = () => setOpenActionMenuProjectId(null)
    window.addEventListener('click', handleWindowClick)
    return () => window.removeEventListener('click', handleWindowClick)
  }, [])

  useEffect(() => {
    if (!openActionMenuProjectId) {
      setActionMenuPosition(null)
      return
    }

    const trigger = actionMenuTriggerRefs.current[openActionMenuProjectId]
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    setActionMenuPosition({
      top: rect.bottom + 8,
      left: rect.right - 150,
    })
  }, [openActionMenuProjectId])

  const filteredProjects = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const viewProjects = projects.filter((project) => {
      if (selectedView === 'archived') return project.status === 'archived'
      if (selectedView === 'trashed') return project.status === 'trashed'
      return project.status !== 'trashed' && project.status !== 'archived'
    })
    const visibleProjects = selectedTagId == null
      ? viewProjects
      : viewProjects.filter((project) => project.tags?.some((tag) => tag.id === selectedTagId))

    if (!normalizedQuery) return visibleProjects

    return visibleProjects.filter((project) =>
      project.name.toLowerCase().includes(normalizedQuery),
    )
  }, [projects, searchQuery, selectedTagId, selectedView])

  const viewTitle = useMemo(() => {
    const currentItem = SIDEBAR_ITEMS.find((item) => item.id === selectedView)
    return currentItem?.label || 'All projects'
  }, [selectedView])

  const selectedTag = useMemo(
    () => tags.find((tag) => tag.id === selectedTagId) || null,
    [selectedTagId, tags],
  )

  const tagProjectCounts = useMemo(() => {
    const counts = new Map()
    tags.forEach((tag) => counts.set(tag.id, 0))
    projects.forEach((project) => {
      project.tags?.forEach((tag) => {
        counts.set(tag.id, (counts.get(tag.id) || 0) + 1)
      })
    })
    return counts
  }, [projects, tags])

  const visibleProjectIds = useMemo(
    () => filteredProjects.map((project) => project.id),
    [filteredProjects],
  )

  const selectedProjectIdSet = useMemo(
    () => new Set(selectedProjectIds),
    [selectedProjectIds],
  )

  const selectedProjects = useMemo(
    () => filteredProjects.filter((project) => selectedProjectIdSet.has(project.id)),
    [filteredProjects, selectedProjectIdSet],
  )

  const allVisibleSelected = visibleProjectIds.length > 0
    && visibleProjectIds.every((projectId) => selectedProjectIdSet.has(projectId))
  const someVisibleSelected = visibleProjectIds.some((projectId) => selectedProjectIdSet.has(projectId))
    && !allVisibleSelected

  useEffect(() => {
    if (!headerCheckboxRef.current) return
    headerCheckboxRef.current.indeterminate = someVisibleSelected
  }, [someVisibleSelected])

  useEffect(() => {
    const visibleIdSet = new Set(visibleProjectIds)
    setSelectedProjectIds((currentIds) => {
      const nextIds = currentIds.filter((projectId) => visibleIdSet.has(projectId))
      return nextIds.length === currentIds.length ? currentIds : nextIds
    })
  }, [visibleProjectIds])

  useEffect(() => {
    if (selectedTagId == null) return
    if (tags.some((tag) => tag.id === selectedTagId)) return
    setSelectedTagId(null)
  }, [selectedTagId, tags])

  useEffect(() => {
    if (newProjectIntentNonce <= 0) return

    const defaultTemplate = TEMPLATE_OPTIONS.find((template) => template.enabled)
    if (!defaultTemplate) return

    openTemplateModal(defaultTemplate)
  }, [newProjectIntentNonce])

  const openTemplateModal = (template) => {
    if (!template.enabled) return

    setSelectedTemplate(template)
    setNewProjectName('')
    setIsTemplateMenuOpen(false)
    setErrorMessage('')
  }

  const closeTemplateModal = () => {
    setSelectedTemplate(null)
    setNewProjectName('')
    setIsCreatingProject(false)
  }

  const createProject = async () => {
    const trimmedName = newProjectName.trim()
    if (!trimmedName || !selectedTemplate || isCreatingProject) return

    setIsCreatingProject(true)

    try {
      const project = await createProjectRequest(trimmedName)

      if (selectedTemplate.content) {
        const files = await listProjectFiles(project.id)
        if (files.length > 0) {
          await updateFileContent(files[0].id, selectedTemplate.content)
        }
      }

      setProjects((currentProjects) => [project, ...currentProjects])
      setErrorMessage('')
      closeTemplateModal()
      onOpenProject(project.id)
    } catch (error) {
      setErrorMessage(error.message || 'Failed to create project')
      setIsCreatingProject(false)
    }
  }

  const closeTagModal = () => {
    setIsTagModalOpen(false)
    setNewTagName('')
    setIsCreatingTag(false)
  }

  const openProjectTagsModal = (project) => {
    setEditingProjectTags(project)
    setDraftTagIds(project.tags?.map((tag) => tag.id) || [])
    setOpenActionMenuProjectId(null)
    setErrorMessage('')
  }

  const closeProjectTagsModal = () => {
    setEditingProjectTags(null)
    setDraftTagIds([])
    setIsSavingProjectTags(false)
  }

  const createTag = async () => {
    const trimmedName = newTagName.trim()
    if (!trimmedName || isCreatingTag) return

    setIsCreatingTag(true)
    try {
      const createdTag = await createTagRequest(trimmedName)
      setTags((currentTags) => [...currentTags, createdTag].sort((left, right) => left.name.localeCompare(right.name)))
      setErrorMessage('')
      closeTagModal()
    } catch (error) {
      setErrorMessage(error.message || 'Failed to create tag')
      setIsCreatingTag(false)
    }
  }

  const removeTag = async (tag) => {
    if (activeProjectAction) return

    setActiveProjectAction(`delete-tag-${tag.id}`)
    try {
      await deleteTagRequest(tag.id)
      setTags((currentTags) => currentTags.filter((currentTag) => currentTag.id !== tag.id))
      setProjects((currentProjects) => currentProjects.map((project) => ({
        ...project,
        tags: (project.tags || []).filter((projectTag) => projectTag.id !== tag.id),
      })))
      setDraftTagIds((currentIds) => currentIds.filter((tagId) => tagId !== tag.id))
      if (selectedTagId === tag.id) {
        setSelectedTagId(null)
      }
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message || 'Failed to delete tag')
    } finally {
      setActiveProjectAction('')
    }
  }

  const saveProjectTags = async () => {
    if (!editingProjectTags || isSavingProjectTags) return

    setIsSavingProjectTags(true)
    try {
      const updatedProject = await updateProjectTagsRequest(editingProjectTags.id, draftTagIds)
      setProjects((currentProjects) =>
        currentProjects.map((project) => (
          project.id === updatedProject.id ? updatedProject : project
        )),
      )
      setErrorMessage('')
      closeProjectTagsModal()
    } catch (error) {
      setErrorMessage(error.message || 'Failed to update project tags')
      setIsSavingProjectTags(false)
    }
  }

  const copyProject = async (project) => {
    if (activeProjectAction) return

    setOpenActionMenuProjectId(null)
    setActiveProjectAction(`copy-${project.id}`)
    try {
      const copiedProject = await copyProjectRequest(project.id)
      setProjects((currentProjects) => [copiedProject, ...currentProjects])
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message || 'Failed to copy project')
    } finally {
      setActiveProjectAction('')
      setOpenActionMenuProjectId(null)
    }
  }

  const updateProjectStatus = async (project, nextStatus) => {
    if (activeProjectAction) return

    setOpenActionMenuProjectId(null)
    setActiveProjectAction(`${nextStatus}-${project.id}`)
    try {
      const updatedProject = await updateProjectStatusRequest(project.id, nextStatus)
      setProjects((currentProjects) =>
        currentProjects.map((currentProject) =>
          currentProject.id === updatedProject.id ? updatedProject : currentProject,
        ),
      )
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message || 'Failed to update project')
    } finally {
      setActiveProjectAction('')
      setConfirmationModal(null)
      setOpenActionMenuProjectId(null)
    }
  }

  const updateProjectsStatusBatch = async (targetProjects, nextStatus) => {
    if (activeProjectAction || targetProjects.length === 0) return

    setOpenActionMenuProjectId(null)
    setActiveProjectAction(`bulk-${nextStatus}`)

    try {
      const results = await Promise.allSettled(
        targetProjects.map((project) => updateProjectStatusRequest(project.id, nextStatus)),
      )
      const updatedProjects = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
      const failedCount = results.length - updatedProjects.length

      if (updatedProjects.length > 0) {
        const updatedProjectMap = new Map(updatedProjects.map((project) => [project.id, project]))
        const updatedIdSet = new Set(updatedProjectMap.keys())

        setProjects((currentProjects) =>
          currentProjects.map((currentProject) => (
            updatedProjectMap.get(currentProject.id) || currentProject
          )),
        )
        setSelectedProjectIds((currentIds) => currentIds.filter((projectId) => !updatedIdSet.has(projectId)))
      }

      if (failedCount > 0) {
        setErrorMessage(`${updatedProjects.length} projects updated, ${failedCount} failed.`)
      } else {
        setErrorMessage('')
      }
    } catch (error) {
      setErrorMessage(error.message || 'Failed to update selected projects')
    } finally {
      setActiveProjectAction('')
      setConfirmationModal(null)
    }
  }

  const deleteProjectsBatch = async (targetProjects) => {
    if (activeProjectAction || targetProjects.length === 0) return

    setOpenActionMenuProjectId(null)
    setActiveProjectAction('bulk-delete')

    try {
      const results = await Promise.allSettled(
        targetProjects.map((project) => deleteProjectRequest(project.id)),
      )
      const deletedIds = results
        .map((result, index) => (result.status === 'fulfilled' ? targetProjects[index].id : null))
        .filter((projectId) => projectId !== null)
      const deletedIdSet = new Set(deletedIds)
      const failedCount = results.length - deletedIds.length

      if (deletedIds.length > 0) {
        setProjects((currentProjects) =>
          currentProjects.filter((currentProject) => !deletedIdSet.has(currentProject.id)),
        )
        setSelectedProjectIds((currentIds) => currentIds.filter((projectId) => !deletedIdSet.has(projectId)))
      }

      if (failedCount > 0) {
        setErrorMessage(`${deletedIds.length} projects deleted, ${failedCount} failed.`)
      } else {
        setErrorMessage('')
      }
    } catch (error) {
      setErrorMessage(error.message || 'Failed to delete selected projects')
    } finally {
      setActiveProjectAction('')
      setConfirmationModal(null)
    }
  }

  const toggleProjectSelection = (projectId) => {
    setSelectedProjectIds((currentIds) => (
      currentIds.includes(projectId)
        ? currentIds.filter((currentId) => currentId !== projectId)
        : [...currentIds, projectId]
    ))
  }

  const toggleAllVisibleProjects = () => {
    setSelectedProjectIds((currentIds) => {
      if (allVisibleSelected) {
        const visibleIdSet = new Set(visibleProjectIds)
        return currentIds.filter((projectId) => !visibleIdSet.has(projectId))
      }

      const nextIds = new Set(currentIds)
      visibleProjectIds.forEach((projectId) => nextIds.add(projectId))
      return Array.from(nextIds)
    })
  }

  const batchArchiveProjects = async () => {
    await updateProjectsStatusBatch(selectedProjects, 'archived')
  }

  const batchRestoreProjects = async () => {
    await updateProjectsStatusBatch(selectedProjects, 'active')
  }

  const confirmBatchDelete = () => {
    if (selectedProjects.length === 0) return

    if (selectedView === 'trashed') {
      setConfirmationModal({
        title: `Delete ${selectedProjects.length} projects permanently?`,
        description: `${selectedProjects.length} selected projects will be deleted permanently together with their files. This cannot be undone.`,
        confirmLabel: 'Delete permanently',
        tone: 'danger',
        onConfirm: () => deleteProjectsBatch(selectedProjects),
      })
      return
    }

    setConfirmationModal({
      title: `Move ${selectedProjects.length} projects to trash?`,
      description: `${selectedProjects.length} selected projects will be moved to Trashed projects. You can restore them later.`,
      confirmLabel: 'Move to trash',
      tone: 'danger',
      onConfirm: () => updateProjectsStatusBatch(selectedProjects, 'trashed'),
    })
  }

  const trashProject = async (project) => {
    setConfirmationModal({
      title: 'Move project to trash?',
      description: `“${project.name}” will be moved to Trashed projects. You can restore it later.`,
      confirmLabel: 'Move to trash',
      tone: 'danger',
      onConfirm: () => updateProjectStatus(project, 'trashed'),
    })
  }

  const archiveProject = async (project) => {
    await updateProjectStatus(project, 'archived')
  }

  const restoreProject = async (project) => {
    await updateProjectStatus(project, 'active')
  }

  const permanentlyDeleteProject = async (project) => {
    setConfirmationModal({
      title: 'Delete project permanently?',
      description: `“${project.name}” will be deleted permanently together with its files. This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      tone: 'danger',
      onConfirm: async () => {
        if (activeProjectAction) return

        setActiveProjectAction(`delete-${project.id}`)
        setOpenActionMenuProjectId(null)
        try {
          await deleteProjectRequest(project.id)
          setProjects((currentProjects) =>
            currentProjects.filter((currentProject) => currentProject.id !== project.id),
          )
          setErrorMessage('')
        } catch (error) {
          setErrorMessage(error.message || 'Failed to delete project')
        } finally {
          setActiveProjectAction('')
          setConfirmationModal(null)
        }
      },
    })
  }

  const renderProjectActions = (project) => {
    if (selectedView === 'trashed') {
      return (
        <>
          <button type="button" style={styles.actionMenuItem} onClick={() => restoreProject(project)}>
            Restore
          </button>
          <button type="button" style={styles.actionMenuItemDanger} onClick={() => permanentlyDeleteProject(project)}>
            {activeProjectAction === `delete-${project.id}` ? 'Deleting...' : 'Delete'}
          </button>
        </>
      )
    }

    if (selectedView === 'archived') {
      return (
        <>
          <button type="button" style={styles.actionMenuItem} onClick={() => openProjectTagsModal(project)}>
            Tags
          </button>
          <button type="button" style={styles.actionMenuItem} onClick={() => restoreProject(project)}>
            Restore
          </button>
          <button type="button" style={styles.actionMenuItemDanger} onClick={() => trashProject(project)}>
            Trash
          </button>
        </>
      )
    }

    return (
      <>
        <button type="button" style={styles.actionMenuItem} onClick={() => copyProject(project)}>
          {activeProjectAction === `copy-${project.id}` ? 'Copying...' : 'Copy'}
        </button>
        <button type="button" style={styles.actionMenuItem} onClick={() => openProjectTagsModal(project)}>
          Tags
        </button>
        <button type="button" style={styles.actionMenuItem} onClick={() => archiveProject(project)}>
          {activeProjectAction === `archived-${project.id}` ? 'Archiving...' : 'Archive'}
        </button>
        <button type="button" style={styles.actionMenuItemDanger} onClick={() => trashProject(project)}>
          {activeProjectAction === `trashed-${project.id}` ? 'Trashing...' : 'Trash'}
        </button>
      </>
    )
  }

  return (
    <div style={styles.page}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}>
          <span style={styles.brandPrefix}>olivame</span>
          <span style={styles.brandWordmark}>typst</span>
        </div>

        <div style={styles.newProjectWrap}>
          <button
            type="button"
            onClick={() => setIsTemplateMenuOpen((open) => !open)}
            style={styles.newProjectButton}
          >
            New project
          </button>

          {isTemplateMenuOpen && (
            <div style={styles.templateMenu}>
              {TEMPLATE_OPTIONS.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => openTemplateModal(template)}
                  style={{
                    ...styles.templateItem,
                    ...(template.enabled ? null : styles.templateItemDisabled),
                  }}
                >
                  <div style={styles.templateLabel}>{template.label}</div>
                  <div style={styles.templateDescription}>{template.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <nav style={styles.nav}>
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedView(item.id)}
              style={{
                ...styles.navItem,
                ...(selectedView === item.id ? styles.navItemActive : null),
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div style={styles.sidebarSection}>
          <div style={styles.sidebarSectionTitle}>Organize tags</div>
          <button type="button" style={styles.tagButton} onClick={() => setIsTagModalOpen(true)}>
            + New tag
          </button>
          {tags.length > 0 ? (
            <div style={styles.tagList}>
              <button
                type="button"
                onClick={() => setSelectedTagId(null)}
                style={{
                  ...styles.tagListItem,
                  ...(selectedTagId == null ? styles.tagListItemActive : null),
                }}
              >
                <span>All tags</span>
                <span style={styles.tagCount}>{projects.filter((project) => (project.tags || []).length > 0).length}</span>
              </button>
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  style={{
                    ...styles.tagListRow,
                    ...(selectedTagId === tag.id ? styles.tagListRowActive : null),
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedTagId(tag.id)}
                    style={{
                      ...styles.tagListItem,
                      ...(selectedTagId === tag.id ? styles.tagListItemActive : null),
                    }}
                  >
                    <span style={styles.tagLabel}>{tag.name}</span>
                    <span style={styles.tagCount}>{tagProjectCounts.get(tag.id) || 0}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    style={styles.tagDeleteButton}
                    title={`Delete tag ${tag.name}`}
                  >
                    {activeProjectAction === `delete-tag-${tag.id}` ? '…' : '×'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </aside>

      <main style={styles.main}>
        <div style={styles.topbar}>
          <div style={styles.pageTitle}>
            {selectedTag ? `${viewTitle} · ${selectedTag.name}` : viewTitle}
          </div>
          <button type="button" style={styles.accountButton}>Admin ▾</button>
        </div>

        <section style={styles.tableCard}>
          <div style={styles.searchRow}>
            <div style={styles.searchBox}>
              <span style={styles.searchIcon}>⌕</span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search in all projects..."
                style={styles.searchInput}
              />
            </div>
          </div>

          {selectedProjects.length > 0 && (
            <div style={styles.selectionToolbar}>
              <div style={styles.selectionSummary}>{selectedProjects.length} selected</div>
              <div style={styles.selectionActions}>
                {selectedView === 'trashed' ? (
                  <>
                    <button
                      type="button"
                      style={styles.selectionActionButton}
                      onClick={batchRestoreProjects}
                      disabled={Boolean(activeProjectAction)}
                    >
                      {activeProjectAction === 'bulk-active' ? 'Restoring...' : 'Restore'}
                    </button>
                    <button
                      type="button"
                      style={{ ...styles.selectionActionButton, ...styles.selectionActionButtonDanger }}
                      onClick={confirmBatchDelete}
                      disabled={Boolean(activeProjectAction)}
                    >
                      {activeProjectAction === 'bulk-delete' ? 'Deleting...' : 'Delete permanently'}
                    </button>
                  </>
                ) : selectedView === 'archived' ? (
                  <>
                    <button
                      type="button"
                      style={styles.selectionActionButton}
                      onClick={batchRestoreProjects}
                      disabled={Boolean(activeProjectAction)}
                    >
                      {activeProjectAction === 'bulk-active' ? 'Restoring...' : 'Restore'}
                    </button>
                    <button
                      type="button"
                      style={{ ...styles.selectionActionButton, ...styles.selectionActionButtonDanger }}
                      onClick={confirmBatchDelete}
                      disabled={Boolean(activeProjectAction)}
                    >
                      {activeProjectAction === 'bulk-trashed' ? 'Deleting...' : 'Delete'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      style={styles.selectionActionButton}
                      onClick={batchArchiveProjects}
                      disabled={Boolean(activeProjectAction)}
                    >
                      {activeProjectAction === 'bulk-archived' ? 'Archiving...' : 'Archive'}
                    </button>
                    <button
                      type="button"
                      style={{ ...styles.selectionActionButton, ...styles.selectionActionButtonDanger }}
                      onClick={confirmBatchDelete}
                      disabled={Boolean(activeProjectAction)}
                    >
                      {activeProjectAction === 'bulk-trashed' ? 'Deleting...' : 'Delete'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  style={styles.selectionClearButton}
                  onClick={() => setSelectedProjectIds([])}
                  disabled={Boolean(activeProjectAction)}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {errorMessage && <div style={styles.errorBanner}>{errorMessage}</div>}

          <div style={styles.table}>
            <div style={{ ...styles.tableRow, ...styles.tableHead }}>
              <div style={{ ...styles.tableCell, ...styles.checkboxCell }}>
                <input
                  ref={headerCheckboxRef}
                  checked={allVisibleSelected}
                  disabled={visibleProjectIds.length === 0}
                  onChange={toggleAllVisibleProjects}
                  style={styles.checkboxInput}
                  type="checkbox"
                />
              </div>
              <div style={{ ...styles.tableCell, ...styles.titleCell }}>Title</div>
              <div style={{ ...styles.tableCell, ...styles.ownerCell }}>Owner</div>
              <div style={{ ...styles.tableCell, ...styles.modifiedCell }}>Last modified ↓</div>
              <div style={{ ...styles.tableCell, ...styles.actionsCell }}>Actions</div>
            </div>

            {filteredProjects.map((project) => (
              <div
                key={project.id}
                style={{
                  ...styles.tableRow,
                  ...(selectedProjectIdSet.has(project.id) ? styles.tableRowSelected : null),
                }}
              >
                <div style={{ ...styles.tableCell, ...styles.checkboxCell }}>
                  <input
                    aria-label={`Select project ${project.name}`}
                    checked={selectedProjectIdSet.has(project.id)}
                    onChange={() => toggleProjectSelection(project.id)}
                    style={styles.checkboxInput}
                    type="checkbox"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                  style={{ ...styles.tableCell, ...styles.titleButton }}
                >
                  <div style={styles.projectTitleStack}>
                    <span>{project.name}</span>
                    {project.tags?.length ? (
                      <span style={styles.projectTagRow}>
                        {project.tags.map((tag) => (
                          <span key={tag.id} style={styles.projectTagChip}>{tag.name}</span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </button>
                <div style={{ ...styles.tableCell, ...styles.ownerCell }}>You</div>
                <div style={{ ...styles.tableCell, ...styles.modifiedCell }}>
                  {formatProjectDate(project.created_at)} by You
                </div>
                <div style={{ ...styles.tableCell, ...styles.actionsCell }}>
                  <div style={styles.actionMenuWrap}>
                    <button
                      type="button"
                      ref={(element) => {
                        actionMenuTriggerRefs.current[project.id] = element
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        setOpenActionMenuProjectId((currentId) =>
                          currentId === project.id ? null : project.id,
                        )
                      }}
                      style={styles.actionMenuTrigger}
                    >
                      ⋯
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={styles.tableFooter}>
            Showing {filteredProjects.length} out of {projects.length} projects.
          </div>
        </section>
      </main>

      {selectedTemplate && (
        <div style={styles.modalOverlay} onClick={closeTemplateModal}>
          <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>New project</div>
              <button type="button" style={styles.modalClose} onClick={closeTemplateModal}>×</button>
            </div>

            <div style={styles.modalBody}>
              <div style={styles.modalLabel}>Template</div>
              <div style={styles.templateBadge}>{selectedTemplate.label}</div>

              <label style={styles.modalLabel} htmlFor="new-project-name">
                Project name
              </label>
              <input
                id="new-project-name"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    createProject()
                  }
                }}
                style={styles.modalInput}
                autoFocus
              />
            </div>

            <div style={styles.modalFooter}>
              <button type="button" onClick={closeTemplateModal} style={styles.modalSecondaryButton}>
                Cancel
              </button>
              <button
                type="button"
                onClick={createProject}
                style={{
                  ...styles.modalPrimaryButton,
                  ...(newProjectName.trim() && !isCreatingProject ? styles.modalPrimaryButtonEnabled : styles.modalPrimaryButtonDisabled),
                }}
                disabled={!newProjectName.trim() || isCreatingProject}
              >
                {isCreatingProject ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isTagModalOpen && (
        <div style={styles.modalOverlay} onClick={closeTagModal}>
          <div style={styles.tagModal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>New tag</div>
              <button type="button" style={styles.modalClose} onClick={closeTagModal}>×</button>
            </div>
            <div style={styles.modalBody}>
              <label style={styles.modalLabel} htmlFor="new-tag-name">
                Tag name
              </label>
              <input
                id="new-tag-name"
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    createTag()
                  }
                }}
                style={styles.modalInput}
                autoFocus
              />
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={closeTagModal} style={styles.modalSecondaryButton}>
                Cancel
              </button>
              <button
                type="button"
                onClick={createTag}
                style={{
                  ...styles.modalPrimaryButton,
                  ...(newTagName.trim() && !isCreatingTag ? styles.modalPrimaryButtonEnabled : styles.modalPrimaryButtonDisabled),
                }}
                disabled={!newTagName.trim() || isCreatingTag}
              >
                {isCreatingTag ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingProjectTags && (
        <div style={styles.modalOverlay} onClick={closeProjectTagsModal}>
          <div style={styles.tagModal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Project tags</div>
              <button type="button" style={styles.modalClose} onClick={closeProjectTagsModal}>×</button>
            </div>
            <div style={styles.modalBody}>
              <div style={styles.modalLabel}>{editingProjectTags.name}</div>
              {tags.length > 0 ? (
                <div style={styles.projectTagSelectionList}>
                  {tags.map((tag) => (
                    <label key={tag.id} style={styles.projectTagSelectionItem}>
                      <input
                        checked={draftTagIds.includes(tag.id)}
                        onChange={() => {
                          setDraftTagIds((currentIds) => (
                            currentIds.includes(tag.id)
                              ? currentIds.filter((currentId) => currentId !== tag.id)
                              : [...currentIds, tag.id]
                          ))
                        }}
                        style={styles.checkboxInput}
                        type="checkbox"
                      />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div style={styles.emptyTagHint}>Create a tag first, then assign it here.</div>
              )}
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={closeProjectTagsModal} style={styles.modalSecondaryButton}>
                Cancel
              </button>
              <button
                type="button"
                onClick={saveProjectTags}
                style={{
                  ...styles.modalPrimaryButton,
                  ...(isSavingProjectTags ? styles.modalPrimaryButtonDisabled : styles.modalPrimaryButtonEnabled),
                }}
                disabled={isSavingProjectTags}
              >
                {isSavingProjectTags ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmationModal && (
        <div style={styles.modalOverlay} onClick={() => setConfirmationModal(null)}>
          <div style={styles.confirmationModal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.confirmationTitle}>{confirmationModal.title}</div>
            <div style={styles.confirmationText}>{confirmationModal.description}</div>
            <div style={styles.confirmationActions}>
              <button
                type="button"
                style={styles.modalSecondaryButton}
                onClick={() => setConfirmationModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  ...styles.confirmationPrimaryButton,
                  ...(confirmationModal.tone === 'danger' ? styles.confirmationPrimaryDanger : null),
                }}
                onClick={() => confirmationModal.onConfirm()}
              >
                {confirmationModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {openActionMenuProjectId && actionMenuPosition && (
        <div
          style={{
            ...styles.actionMenuPortal,
            top: actionMenuPosition.top,
            left: actionMenuPosition.left,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {renderProjectActions(
            projects.find((project) => project.id === openActionMenuProjectId),
          )}
        </div>
      )}
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    background: '#f3f5f7',
    color: '#1f2937',
  },
  sidebar: {
    width: '240px',
    background: '#fbfcfc',
    borderRight: '1px solid #d9e0e5',
    padding: '28px 20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  brand: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    paddingBottom: '6px',
  },
  brandPrefix: {
    fontSize: '13px',
    fontWeight: '700',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#64748b',
  },
  brandWordmark: {
    fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
    fontSize: '34px',
    fontWeight: '700',
    fontStyle: 'italic',
    letterSpacing: '-0.04em',
    lineHeight: 1,
    color: '#334155',
  },
  newProjectWrap: {
    position: 'relative',
  },
  newProjectButton: {
    width: '100%',
    border: 'none',
    borderRadius: '999px',
    background: '#4f97dd',
    color: '#fff',
    fontSize: '15px',
    fontWeight: '700',
    padding: '14px 18px',
    cursor: 'pointer',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)',
  },
  templateMenu: {
    position: 'absolute',
    top: 'calc(100% + 10px)',
    left: 0,
    width: '100%',
    background: '#fff',
    border: '1px solid #d9e0e5',
    borderRadius: '14px',
    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.14)',
    overflow: 'hidden',
    zIndex: 20,
  },
  templateItem: {
    width: '100%',
    padding: '14px 16px',
    background: '#fff',
    border: 'none',
    borderBottom: '1px solid #edf1f4',
    cursor: 'pointer',
    textAlign: 'left',
  },
  templateItemDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  templateLabel: {
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '4px',
    color: '#1f2937',
  },
  templateDescription: {
    fontSize: '13px',
    color: '#6b7280',
    lineHeight: '1.4',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingBottom: '18px',
    borderBottom: '1px solid #e5eaef',
  },
  navItem: {
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    color: '#475569',
    padding: '10px 12px',
    borderRadius: '10px',
    fontSize: '15px',
    cursor: 'pointer',
  },
  navItemActive: {
    background: '#deecfb',
    color: '#1e293b',
    fontWeight: '600',
  },
  sidebarSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sidebarSectionTitle: {
    fontSize: '13px',
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#64748b',
    letterSpacing: '0.04em',
  },
  tagButton: {
    border: 'none',
    background: 'transparent',
    padding: 0,
    textAlign: 'left',
    color: '#475569',
    cursor: 'pointer',
    fontSize: '15px',
  },
  tagList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  tagListRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  tagListRowActive: {
    background: '#eef5fd',
    borderRadius: '10px',
  },
  tagListItem: {
    border: 'none',
    background: 'transparent',
    color: '#475569',
    padding: '8px 10px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    width: '100%',
    cursor: 'pointer',
    fontSize: '14px',
    textAlign: 'left',
  },
  tagListItemActive: {
    color: '#163a63',
    fontWeight: '700',
  },
  tagLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tagCount: {
    minWidth: '22px',
    height: '22px',
    borderRadius: '999px',
    background: '#dde8f5',
    color: '#4b6684',
    fontSize: '12px',
    fontWeight: '700',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 6px',
  },
  tagDeleteButton: {
    border: 'none',
    background: 'transparent',
    color: '#7c8da0',
    width: '28px',
    height: '28px',
    borderRadius: '999px',
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: 1,
    flexShrink: 0,
  },
  main: {
    flex: 1,
    padding: '26px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    minWidth: 0,
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageTitle: {
    fontSize: '38px',
    fontWeight: '700',
    color: '#334155',
  },
  accountButton: {
    border: 'none',
    background: 'transparent',
    color: '#475569',
    fontSize: '15px',
    cursor: 'pointer',
  },
  tableCard: {
    background: '#fff',
    border: '1px solid #d8dee4',
    borderRadius: '18px',
    overflow: 'hidden',
    boxShadow: '0 12px 30px rgba(148, 163, 184, 0.14)',
  },
  searchRow: {
    padding: '18px 20px 10px',
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    border: '1px solid #b8c2cc',
    borderRadius: '10px',
    padding: '0 14px',
    height: '48px',
  },
  searchIcon: {
    color: '#64748b',
    fontSize: '16px',
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    width: '100%',
    fontSize: '15px',
    background: 'transparent',
    color: '#0f172a',
  },
  errorBanner: {
    margin: '0 20px 14px',
    padding: '12px 14px',
    borderRadius: '10px',
    background: '#fef2f2',
    color: '#b42318',
    fontSize: '14px',
  },
  selectionToolbar: {
    margin: '0 20px 14px',
    padding: '12px 14px',
    borderRadius: '12px',
    background: '#edf5fd',
    border: '1px solid #cfe0f4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '14px',
  },
  selectionSummary: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#23476d',
  },
  selectionActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  selectionActionButton: {
    border: '1px solid #7da3cc',
    background: '#ffffff',
    color: '#2c4e74',
    borderRadius: '999px',
    padding: '9px 14px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  selectionActionButtonDanger: {
    borderColor: '#d7a4a0',
    color: '#a83f35',
  },
  selectionClearButton: {
    border: 'none',
    background: 'transparent',
    color: '#56718f',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
  },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '46px minmax(240px, 1.6fr) 140px 220px 220px',
    alignItems: 'center',
    borderTop: '1px solid #edf1f4',
    minHeight: '58px',
  },
  tableHead: {
    background: '#f8fafc',
    color: '#475569',
    fontWeight: '700',
    fontSize: '14px',
  },
  tableCell: {
    padding: '0 14px',
    fontSize: '15px',
    color: '#334155',
  },
  tableRowSelected: {
    background: '#f5f9fe',
  },
  checkboxCell: {
    textAlign: 'center',
    color: '#94a3b8',
  },
  checkboxInput: {
    width: '14px',
    height: '14px',
    accentColor: '#4f97dd',
    cursor: 'pointer',
  },
  titleCell: {
    fontWeight: '700',
  },
  titleButton: {
    border: 'none',
    background: 'transparent',
    padding: '0 14px',
    textAlign: 'left',
    fontSize: '15px',
    fontWeight: '600',
    color: '#0f172a',
    cursor: 'pointer',
  },
  projectTitleStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 0',
  },
  projectTagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  projectTagChip: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '999px',
    background: '#e9f1fa',
    color: '#476788',
    fontSize: '12px',
    fontWeight: '700',
    padding: '4px 8px',
  },
  ownerCell: {
    color: '#475569',
  },
  modifiedCell: {
    color: '#64748b',
  },
  actionsCell: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  actionMenuWrap: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  actionMenuTrigger: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    border: '1px solid #d6dde5',
    background: '#fff',
    color: '#475569',
    fontSize: '24px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  actionMenuPortal: {
    position: 'fixed',
    minWidth: '150px',
    background: '#fff',
    border: '1px solid #d9e0e5',
    borderRadius: '12px',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.14)',
    padding: '8px',
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  actionMenuItem: {
    border: 'none',
    background: '#fff',
    color: '#334155',
    borderRadius: '8px',
    fontSize: '14px',
    padding: '10px 12px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  actionMenuItemDanger: {
    border: 'none',
    background: '#fff',
    color: '#b42318',
    borderRadius: '8px',
    fontSize: '14px',
    padding: '10px 12px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  tableFooter: {
    padding: '18px 20px 22px',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '15px',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.38)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 40,
  },
  modal: {
    width: '100%',
    maxWidth: '680px',
    background: '#fff',
    borderRadius: '18px',
    overflow: 'hidden',
    boxShadow: '0 30px 80px rgba(15, 23, 42, 0.28)',
  },
  tagModal: {
    width: '100%',
    maxWidth: '460px',
    background: '#fff',
    borderRadius: '18px',
    overflow: 'hidden',
    boxShadow: '0 30px 80px rgba(15, 23, 42, 0.28)',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: '1px solid #e5eaef',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1f2937',
  },
  modalClose: {
    border: 'none',
    background: 'transparent',
    fontSize: '30px',
    lineHeight: 1,
    color: '#475569',
    cursor: 'pointer',
  },
  modalBody: {
    padding: '22px 24px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  modalLabel: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#475569',
  },
  templateBadge: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    padding: '8px 12px',
    background: '#e7f1fc',
    color: '#2f6fae',
    borderRadius: '999px',
    fontSize: '13px',
    fontWeight: '700',
    marginBottom: '8px',
  },
  modalInput: {
    width: '100%',
    height: '48px',
    padding: '0 14px',
    border: '2px solid #5b8def',
    borderRadius: '10px',
    outline: 'none',
    fontSize: '15px',
  },
  projectTagSelectionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginTop: '8px',
  },
  projectTagSelectionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '15px',
    color: '#334155',
  },
  emptyTagHint: {
    fontSize: '14px',
    color: '#64748b',
    lineHeight: '1.5',
    marginTop: '6px',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '18px 24px 24px',
    borderTop: '1px solid #e5eaef',
  },
  modalSecondaryButton: {
    border: '1px solid #94a3b8',
    background: '#fff',
    color: '#334155',
    borderRadius: '999px',
    padding: '10px 18px',
    fontSize: '15px',
    cursor: 'pointer',
  },
  modalPrimaryButton: {
    border: 'none',
    background: '#dbe4f1',
    color: '#475569',
    borderRadius: '999px',
    padding: '10px 18px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  modalPrimaryButtonEnabled: {
    background: '#4f97dd',
    color: '#ffffff',
  },
  modalPrimaryButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  confirmationModal: {
    width: '100%',
    maxWidth: '520px',
    background: '#ffffff',
    borderRadius: '18px',
    padding: '28px',
    boxShadow: '0 30px 80px rgba(15, 23, 42, 0.28)',
  },
  confirmationTitle: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: '10px',
  },
  confirmationText: {
    fontSize: '15px',
    lineHeight: '1.6',
    color: '#475569',
    marginBottom: '24px',
  },
  confirmationActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
  },
  confirmationPrimaryButton: {
    border: 'none',
    borderRadius: '999px',
    padding: '11px 18px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    background: '#4f97dd',
    color: '#ffffff',
  },
  confirmationPrimaryDanger: {
    background: '#b42318',
  },
}
