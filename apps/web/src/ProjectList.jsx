import { useEffect, useMemo, useState } from 'react'
import {
  createProject as createProjectRequest,
  listProjectFiles,
  listProjects,
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
    content: `= Demo document

#set text(font: ("Liberation Sans", "Noto Sans CJK SC"))

This is an example Typst project.

== Highlights

- Clean structure
- Ready to compile
- Easy to extend

== Table

#table(
  columns: 2,
  [Item], [Status],
  [Outline], [Done],
  [Preview], [Ready],
)
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
  'All projects',
  'Your projects',
  'Shared with you',
  'Archived projects',
  'Trashed projects',
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

function ActionButton({ label, onClick }) {
  return (
    <button type="button" onClick={onClick} style={styles.actionButton}>
      {label}
    </button>
  )
}

export default function ProjectList({ onOpenProject }) {
  const [projects, setProjects] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((error) => setErrorMessage(error.message || 'Failed to load projects'))
  }, [])

  const filteredProjects = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return projects

    return projects.filter((project) =>
      project.name.toLowerCase().includes(normalizedQuery),
    )
  }, [projects, searchQuery])

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
          {SIDEBAR_ITEMS.map((item, index) => (
            <button
              key={item}
              type="button"
              style={{
                ...styles.navItem,
                ...(index === 0 ? styles.navItemActive : null),
              }}
            >
              {item}
            </button>
          ))}
        </nav>

        <div style={styles.sidebarSection}>
          <div style={styles.sidebarSectionTitle}>Organize tags</div>
          <button type="button" style={styles.tagButton}>+ New tag</button>
        </div>
      </aside>

      <main style={styles.main}>
        <div style={styles.topbar}>
          <div style={styles.pageTitle}>All projects</div>
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

          {errorMessage && <div style={styles.errorBanner}>{errorMessage}</div>}

          <div style={styles.table}>
            <div style={{ ...styles.tableRow, ...styles.tableHead }}>
              <div style={{ ...styles.tableCell, ...styles.checkboxCell }}>□</div>
              <div style={{ ...styles.tableCell, ...styles.titleCell }}>Title</div>
              <div style={{ ...styles.tableCell, ...styles.ownerCell }}>Owner</div>
              <div style={{ ...styles.tableCell, ...styles.modifiedCell }}>Last modified ↓</div>
              <div style={{ ...styles.tableCell, ...styles.actionsCell }}>Actions</div>
            </div>

            {filteredProjects.map((project) => (
              <div key={project.id} style={styles.tableRow}>
                <div style={{ ...styles.tableCell, ...styles.checkboxCell }}>□</div>
                <button
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                  style={{ ...styles.tableCell, ...styles.titleButton }}
                >
                  {project.name}
                </button>
                <div style={{ ...styles.tableCell, ...styles.ownerCell }}>You</div>
                <div style={{ ...styles.tableCell, ...styles.modifiedCell }}>
                  {formatProjectDate(project.created_at)} by You
                </div>
                <div style={{ ...styles.tableCell, ...styles.actionsCell }}>
                  <ActionButton label="Open" onClick={() => onOpenProject(project.id)} />
                  <ActionButton label="Copy" onClick={() => {}} />
                  <ActionButton label="Trash" onClick={() => {}} />
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
    background: '#138a42',
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
    background: '#dfe9e3',
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
  checkboxCell: {
    textAlign: 'center',
    color: '#94a3b8',
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
  actionButton: {
    border: '1px solid #d6dde5',
    background: '#fff',
    color: '#475569',
    borderRadius: '8px',
    fontSize: '13px',
    padding: '7px 10px',
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
    background: '#eff6f1',
    color: '#166534',
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
    background: '#138a42',
    color: '#ffffff',
  },
  modalPrimaryButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
}
