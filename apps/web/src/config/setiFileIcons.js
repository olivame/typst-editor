import setiFontUrl from '../assets/seti/seti.woff'
import setiTheme from '../assets/seti/vs-seti-icon-theme.json'

const CUSTOM_FILE_EXTENSIONS = {
  bib: '_tex_1',
  typ: '_tex',
}

const fileNames = new Map(
  Object.entries(setiTheme.fileNames || {}).map(([key, value]) => [key.toLowerCase(), value]),
)

const fileExtensions = new Map(
  Object.entries({
    ...(setiTheme.fileExtensions || {}),
    ...CUSTOM_FILE_EXTENSIONS,
  }).map(([key, value]) => [key.toLowerCase(), value]),
)

const defaultIconId = setiTheme.file || '_default'
const iconDefinitions = setiTheme.iconDefinitions || {}

let didInjectFont = false

function toCharacter(fontCharacter) {
  if (!fontCharacter) return ''
  return String.fromCodePoint(Number.parseInt(fontCharacter.replace('\\', ''), 16))
}

function getIconDefinition(iconId) {
  return iconDefinitions[iconId] || iconDefinitions[defaultIconId] || null
}

function resolveFileNameIcon(name) {
  const normalizedName = name.toLowerCase()
  if (fileNames.has(normalizedName)) return fileNames.get(normalizedName)
  if (normalizedName.startsWith('.') && fileNames.has(normalizedName.slice(1))) {
    return fileNames.get(normalizedName.slice(1))
  }
  return ''
}

function resolveFileExtensionIcon(name) {
  const normalizedName = name.toLowerCase()
  const trimmedName = normalizedName.startsWith('.') ? normalizedName.slice(1) : normalizedName
  const parts = trimmedName.split('.')

  if (parts.length <= 1) return ''

  for (let index = 1; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join('.')
    if (fileExtensions.has(candidate)) return fileExtensions.get(candidate)
  }

  return ''
}

export function ensureSetiFont() {
  if (didInjectFont || typeof document === 'undefined') return

  const style = document.createElement('style')
  style.textContent = `
    @font-face {
      font-family: 'Seti';
      src: url('${setiFontUrl}') format('woff');
      font-style: normal;
      font-weight: 400;
    }
  `

  document.head.appendChild(style)
  didInjectFont = true
}

export function getSetiFileIcon(name) {
  const iconId = resolveFileNameIcon(name) || resolveFileExtensionIcon(name) || defaultIconId
  const icon = getIconDefinition(iconId)

  if (!icon) {
    return {
      character: '',
      color: '#d4d7d6',
    }
  }

  return {
    character: toCharacter(icon.fontCharacter),
    color: icon.fontColor || '#d4d7d6',
  }
}
