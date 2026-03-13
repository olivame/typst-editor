import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import DiagnosticsSidebar from './components/DiagnosticsSidebar'
import EditorToolbar from './components/EditorToolbar'
import FileAssetPreview from './components/FileAssetPreview'
import FileSidebar from './components/FileSidebar'
import OutlineSidebar from './components/OutlineSidebar'
import SearchSidebar from './components/SearchSidebar'
import TinymistPreview from './components/TinymistPreview'
import {
  createProjectFile,
  createProjectFolder,
  deleteProjectEntry,
  downloadProjectFile,
  downloadProjectPdf,
  getFileContent,
  getProjectFileUrl,
  getProjectPreviewStatus,
  getProjectPreviewUrl,
  listAvailableFonts,
  listProjectFiles,
  renameProjectEntry,
  searchProjectFiles,
  updateFileContent,
  uploadProjectFiles,
} from './services/projects'

function ListToolGlyph({ kind }) {
  const markers = kind === 'ordered' ? ['1', '2', '3'] : ['•', '•', '•']

  return (
    <span style={styles.listToolGlyph}>
      {markers.map((marker, index) => (
        <span key={`${kind}-${marker}-${index}`} style={styles.listToolGlyphRow}>
          <span style={styles.listToolGlyphMarker}>{marker}</span>
          <span style={styles.listToolGlyphLine} />
        </span>
      ))}
    </span>
  )
}

function DiagnosticsRailGlyph() {
  return (
    <span style={styles.diagnosticsRailGlyph} aria-hidden="true">
      <svg viewBox="0 0 24 24" style={styles.diagnosticsRailGlyphSvg}>
        <path
          d="M8 3.5H16L21 12L16 20.5H8L3 12Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M12 8V12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="16.2" r="1.1" fill="currentColor" />
      </svg>
    </span>
  )
}

const RAIL_ITEMS = [
  { id: 'files', label: '≡', title: 'Files' },
  { id: 'search', label: '⌕', title: 'Search' },
  { id: 'outline', label: '☷', title: 'Outline' },
  { id: 'errors', label: <DiagnosticsRailGlyph />, title: 'Diagnostics' },
  { id: 'settings', label: '⚙', title: 'Settings' },
]

const FALLBACK_ENGLISH_FONT_OPTIONS = [
  'Liberation Sans',
  'Liberation Serif',
  'Liberation Mono',
]

const FALLBACK_CHINESE_FONT_OPTIONS = [
  'Noto Sans CJK SC',
  'Noto Serif CJK SC',
  'Noto Sans Mono CJK SC',
  'Noto Sans CJK TC',
  'Noto Serif CJK TC',
  'Noto Sans Mono CJK TC',
  'Noto Sans CJK HK',
  'Noto Serif CJK HK',
  'Noto Sans Mono CJK HK',
  'Noto Sans CJK JP',
  'Noto Serif CJK JP',
  'Noto Sans Mono CJK JP',
  'Noto Sans CJK KR',
  'Noto Serif CJK KR',
  'Noto Sans Mono CJK KR',
]

const CJK_FONT_PATTERN = /(cjk|han|yahei|hei|song|kai|fang|ming|mincho|gothic|simsun|simhei|kaiti|fangsong|mingliu|pmingliu|batang|gulim|malgun)/i

const EDITOR_TOOL_ITEMS = [
  { id: 'font', label: 'T', title: 'Set fonts' },
  { id: 'bold', label: 'B', title: 'Bold' },
  { id: 'italic', label: 'I', title: 'Italic' },
  { id: 'underline', label: 'U', title: 'Underline' },
  { id: 'heading', label: 'H', title: 'Heading' },
  { id: 'bullet', label: <ListToolGlyph kind="bullet" />, title: 'Bullet list' },
  { id: 'align', label: <ListToolGlyph kind="ordered" />, title: 'Numbered list' },
  { id: 'math', label: 'Σ', title: 'Math' },
  { id: 'code', label: '<>', title: 'Code block' },
  { id: 'reference', label: '@', title: 'Reference' },
]
const PREVIEW_ZOOM_FACTORS = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
  1.1, 1.3, 1.5, 1.7, 1.9, 2.1, 2.4, 2.7,
  3, 3.3, 3.7, 4.1, 4.6, 5.1, 5.7, 6.3, 7, 7.7, 8.5, 9.4, 10,
]
const PYTHON_CODE_BLOCK_TEMPLATE = '```python\n\n```'

function findNearestPreviewZoom(value) {
  return PREVIEW_ZOOM_FACTORS.reduce((nearest, factor) => (
    Math.abs(factor - value) < Math.abs(nearest - value) ? factor : nearest
  ), PREVIEW_ZOOM_FACTORS[0])
}

function getAdjacentPreviewZoom(current, direction) {
  const nearest = findNearestPreviewZoom(current)
  const currentIndex = PREVIEW_ZOOM_FACTORS.findIndex((factor) => factor === nearest)
  if (currentIndex === -1) return 1
  if (direction > 0) {
    return PREVIEW_ZOOM_FACTORS[Math.min(currentIndex + 1, PREVIEW_ZOOM_FACTORS.length - 1)]
  }
  if (direction < 0) {
    return PREVIEW_ZOOM_FACTORS[Math.max(currentIndex - 1, 0)]
  }
  return nearest
}

function getSelectionOffset(content, line, character) {
  const lines = content.split('\n')
  const boundedLine = Math.max(0, Math.min(line, lines.length - 1))
  const offsetBeforeLine = lines
    .slice(0, boundedLine)
    .reduce((total, currentLine) => total + currentLine.length + 1, 0)
  const boundedCharacter = Math.max(0, Math.min(character, lines[boundedLine]?.length ?? 0))
  return offsetBeforeLine + boundedCharacter
}

function getParentPath(path) {
  if (!path || !path.includes('/')) return ''
  return path.split('/').slice(0, -1).join('/')
}

function normalizePreviewFilePath(filepath, projectId) {
  const projectMarker = `/workspace/projects/${projectId}/`
  if (filepath.includes(projectMarker)) {
    return filepath.split(projectMarker)[1]
  }

  return filepath.split('/').filter(Boolean).slice(-1)[0] || filepath
}

function extractTextValue(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return `${value}`
  if (Array.isArray(value)) {
    return value.map((item) => extractTextValue(item)).filter(Boolean).join('\n').trim()
  }

  if (value && typeof value === 'object') {
    const candidates = [
      value.message,
      value.text,
      value.value,
      value.body,
      value.label,
      value.title,
      value.reason,
      value.plainText,
    ]

    for (const candidate of candidates) {
      const normalized = extractTextValue(candidate)
      if (normalized) return normalized
    }
  }

  return ''
}

function normalizePosition(position) {
  if (Array.isArray(position)) {
    return [
      Math.max(Number(position[0]) || 0, 0),
      Math.max(Number(position[1]) || 0, 0),
    ]
  }

  if (position && typeof position === 'object') {
    return [
      Math.max(Number(position.line ?? position.row) || 0, 0),
      Math.max(Number(position.character ?? position.column) || 0, 0),
    ]
  }

  return null
}

function extractLocation(candidate) {
  if (!candidate || typeof candidate !== 'object') return null

  const directPath = candidate.filepath || candidate.path || candidate.file || candidate.uri
  const rangeSource = candidate.range || candidate.span || candidate.location || candidate
  const start = normalizePosition(candidate.start ?? rangeSource?.start ?? rangeSource?.from)
  const end = normalizePosition(candidate.end ?? rangeSource?.end ?? rangeSource?.to ?? start)
  const nestedPath = rangeSource?.filepath || rangeSource?.path || rangeSource?.file || rangeSource?.uri
  const path = typeof (directPath || nestedPath) === 'string' ? (directPath || nestedPath) : ''

  if (!path && !start && !end) return null

  return {
    path,
    start,
    end: end || start,
  }
}

function looksLikeDiagnostic(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false

  return Boolean(
    extractTextValue(candidate.message || candidate.reason || candidate.error || candidate.description)
      || candidate.severity
      || candidate.level
      || candidate.range
      || candidate.span
      || candidate.filepath
      || candidate.path,
  )
}

function collectDiagnosticCandidates(node, results, visited = new Set(), depth = 0) {
  if (!node || typeof node !== 'object' || visited.has(node) || depth > 4) return

  visited.add(node)

  if (Array.isArray(node)) {
    node.forEach((item) => collectDiagnosticCandidates(item, results, visited, depth + 1))
    return
  }

  if (looksLikeDiagnostic(node)) {
    results.push(node)
  }

  Object.entries(node).forEach(([key, value]) => {
    if (
      depth === 0
      || ['diagnostics', 'errors', 'warnings', 'messages', 'items', 'causes', 'notes', 'status'].includes(key)
    ) {
      collectDiagnosticCandidates(value, results, visited, depth + 1)
    }
  })
}

function normalizePreviewLocation(location, projectId) {
  if (!location?.path || !location?.start) return null

  const normalizedPath = normalizePreviewFilePath(location.path, projectId)
  const [startLine, startCharacter] = location.start
  const [endLine, endCharacter] = location.end || location.start

  return {
    path: normalizedPath,
    start: [startLine, startCharacter],
    end: [endLine, endCharacter],
    startLine,
    startCharacter,
    endLine,
    endCharacter,
    lineNumber: startLine + 1,
  }
}

function normalizeDiagnostics(status, projectId) {
  const candidates = []
  collectDiagnosticCandidates(status, candidates)

  const fallbackMessage = extractTextValue(status?.message || status?.reason || status?.error)
  if (candidates.length === 0 && fallbackMessage) {
    candidates.push(status)
  }

  const deduped = new Map()

  candidates.forEach((candidate, index) => {
    const message = extractTextValue(
      candidate.message || candidate.reason || candidate.error || candidate.description || candidate.title,
    )
    if (!message) return

    const location = normalizePreviewLocation(extractLocation(candidate), projectId)
    const severity = `${candidate.severity || candidate.level || candidate.kind || candidate.type || 'error'}`
      .toLowerCase()
    const path = location?.path || ''
    const locationLabel = location
      ? `${location.path}:${location.lineNumber}:${(location.startCharacter ?? 0) + 1}`
      : ''
    const key = `${severity}::${path}::${location?.lineNumber || ''}::${message}`

    if (deduped.has(key)) return

    deduped.set(key, {
      id: `${key}-${index}`,
      severity,
      message,
      path,
      location,
      locationLabel,
    })
  })

  return Array.from(deduped.values())
}

function normalizeOutlineItems(items, projectId, depth = 0, lineage = []) {
  return (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const path = [...lineage, index]
    const normalizedItem = {
      ...item,
      depth,
      pathKey: path.join('-'),
      location: normalizePreviewLocation(extractLocation(item), projectId),
    }

    return [
      normalizedItem,
      ...normalizeOutlineItems(item?.children, projectId, depth + 1, path),
    ]
  })
}

function normalizeComparisonText(value) {
  return `${value || ''}`.toLowerCase().replace(/\s+/g, ' ').trim()
}

function findOutlineHeadingInSource(source, title) {
  const normalizedTitle = normalizeComparisonText(title)
  if (!normalizedTitle) return null

  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^\s*(=+)\s+(.*)$/)
    if (!match) continue

    const headingText = match[2].replace(/\s*<[^>]+>\s*$/g, '').trim()
    if (normalizeComparisonText(headingText) !== normalizedTitle) continue

    const start = line.indexOf(headingText)
    return {
      lineNumber: index + 1,
      start: Math.max(start, 0),
      end: Math.max(start, 0) + headingText.length,
    }
  }

  return null
}

function sortFontNames(fontNames) {
  return [...fontNames].sort((left, right) => left.localeCompare(right))
}

function isCjkFontName(fontName) {
  return CJK_FONT_PATTERN.test(fontName)
}

function buildFontOptions(fontNames) {
  const normalizedFonts = Array.from(new Set(
    (Array.isArray(fontNames) ? fontNames : [])
      .map((fontName) => `${fontName}`.trim())
      .filter(Boolean),
  ))
  const chineseFonts = sortFontNames(normalizedFonts.filter((fontName) => isCjkFontName(fontName)))
  const englishFonts = sortFontNames(normalizedFonts.filter((fontName) => !isCjkFontName(fontName)))

  return {
    englishFonts: englishFonts.length > 0 ? englishFonts : FALLBACK_ENGLISH_FONT_OPTIONS,
    chineseFonts: chineseFonts.length > 0 ? chineseFonts : FALLBACK_CHINESE_FONT_OPTIONS,
  }
}

function findTextDirectiveRange(source) {
  const match = source.match(/^#set\s+text\s*\(/m)
  if (!match || match.index == null) return null

  const start = match.index
  const openParenIndex = source.indexOf('(', start)
  if (openParenIndex === -1) return null

  let depth = 0
  let inString = false
  let isEscaped = false

  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (isEscaped) {
        isEscaped = false
        continue
      }
      if (char === '\\') {
        isEscaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '(') {
      depth += 1
      continue
    }

    if (char === ')') {
      depth -= 1
      if (depth === 0) {
        return {
          start,
          end: index,
          paramsStart: openParenIndex + 1,
          paramsEnd: index,
        }
      }
    }
  }

  return null
}

function splitTopLevelSegments(source, delimiter = ',') {
  const segments = []
  let depth = 0
  let inString = false
  let isEscaped = false
  let segmentStart = 0

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (isEscaped) {
        isEscaped = false
        continue
      }
      if (char === '\\') {
        isEscaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '(') {
      depth += 1
      continue
    }

    if (char === ')') {
      depth = Math.max(depth - 1, 0)
      continue
    }

    if (char === delimiter && depth === 0) {
      segments.push(source.slice(segmentStart, index))
      segmentStart = index + 1
    }
  }

  segments.push(source.slice(segmentStart))
  return segments
}

function buildTypstFontValue(englishFont, chineseFont) {
  const families = [englishFont, chineseFont].filter(Boolean)

  if (families.length === 0) return ''
  if (families.length === 1) return `"${families[0]}"`

  return `(${families.map((family) => `"${family}"`).join(', ')})`
}

function updateTextFontDirective(source, fontValue) {
  const directiveRange = findTextDirectiveRange(source)

  if (!directiveRange) {
    if (!fontValue) return source
    return source
      ? `#set text(font: ${fontValue})\n\n${source}`
      : `#set text(font: ${fontValue})`
  }

  const params = source.slice(directiveRange.paramsStart, directiveRange.paramsEnd)
  const segments = splitTopLevelSegments(params)
    .map((segment) => segment.trim())
    .filter(Boolean)

  const nextSegments = []
  let hasFontParam = false

  segments.forEach((segment) => {
    if (/^font\s*:/.test(segment)) {
      hasFontParam = true
      if (fontValue) {
        nextSegments.push(`font: ${fontValue}`)
      }
      return
    }

    nextSegments.push(segment)
  })

  if (!hasFontParam && fontValue) {
    nextSegments.push(`font: ${fontValue}`)
  }

  const nextDirective = nextSegments.length > 0
    ? `#set text(${nextSegments.join(', ')})`
    : ''

  const before = source.slice(0, directiveRange.start)
  const after = source.slice(directiveRange.end + 1)

  if (nextDirective) {
    return `${before}${nextDirective}${after}`
  }

  const trimmedBefore = before.endsWith('\n') ? before.slice(0, -1) : before
  const trimmedAfter = after.startsWith('\n') ? after.slice(1) : after
  return `${trimmedBefore}${trimmedAfter}`
}

function extractQuotedStrings(source) {
  const values = []
  const pattern = /"((?:[^"\\]|\\.)*)"/g
  let match = pattern.exec(source)

  while (match) {
    values.push(match[1].replace(/\\"/g, '"'))
    match = pattern.exec(source)
  }

  return values
}

function parseFontSelection(source, fontOptions) {
  const directiveRange = findTextDirectiveRange(source)
  if (!directiveRange) {
    return { englishFont: '', chineseFont: '' }
  }

  const params = source.slice(directiveRange.paramsStart, directiveRange.paramsEnd)
  const fontSegment = splitTopLevelSegments(params)
    .map((segment) => segment.trim())
    .find((segment) => /^font\s*:/.test(segment))

  if (!fontSegment) {
    return { englishFont: '', chineseFont: '' }
  }

  const fontNames = extractQuotedStrings(fontSegment.replace(/^font\s*:\s*/, ''))
  const englishFontSet = new Set(fontOptions.englishFonts)
  const chineseFontSet = new Set(fontOptions.chineseFonts)
  const chineseFont = fontNames.find((fontName) => chineseFontSet.has(fontName)) || (fontNames[1] || '')
  const englishFont = fontNames.find((fontName) => englishFontSet.has(fontName)) || (fontNames[0] || '')

  return {
    englishFont,
    chineseFont,
  }
}

function replaceSelectionRange(source, selectionStart, selectionEnd, replacement) {
  return `${source.slice(0, selectionStart)}${replacement}${source.slice(selectionEnd)}`
}

function wrapSelection(source, selectionStart, selectionEnd, prefix, suffix, placeholder = '') {
  const hasSelection = selectionStart !== selectionEnd
  const body = hasSelection ? source.slice(selectionStart, selectionEnd) : placeholder
  const replacement = `${prefix}${body}${suffix}`

  return {
    content: replaceSelectionRange(source, selectionStart, selectionEnd, replacement),
    selectionStart: selectionStart + prefix.length,
    selectionEnd: selectionStart + prefix.length + body.length,
  }
}

function insertPairedMarkers(source, selectionStart, selectionEnd, marker) {
  if (selectionStart !== selectionEnd) {
    return wrapSelection(source, selectionStart, selectionEnd, marker, marker)
  }

  return {
    content: replaceSelectionRange(source, selectionStart, selectionEnd, marker + marker),
    selectionStart: selectionStart + marker.length,
    selectionEnd: selectionStart + marker.length,
  }
}

function insertTemplate(source, selectionStart, selectionEnd, template, cursorOffset = template.length) {
  return {
    content: replaceSelectionRange(source, selectionStart, selectionEnd, template),
    selectionStart: selectionStart + cursorOffset,
    selectionEnd: selectionStart + cursorOffset,
  }
}

function insertReferenceTemplate(source, selectionStart, selectionEnd, citationKey = '') {
  const referenceMarker = citationKey ? `@${citationKey}` : '@'
  return insertTemplate(source, selectionStart, selectionEnd, referenceMarker, referenceMarker.length)
}

function parseBibReferenceOptions(bibliographyFiles) {
  const referencesByKey = new Map()
  const citationPattern = /@([A-Za-z]+)\s*[{(]\s*([^,\s]+)\s*,/g

  bibliographyFiles.forEach((file) => {
    const source = `${file?.content || ''}`
    citationPattern.lastIndex = 0
    let match = citationPattern.exec(source)

    while (match) {
      const entryType = `${match[1] || ''}`.toLowerCase()
      const citationKey = `${match[2] || ''}`.trim()

      if (!['comment', 'preamble', 'string'].includes(entryType) && citationKey) {
        const existingReference = referencesByKey.get(citationKey)

        if (existingReference) {
          if (!existingReference.paths.includes(file.path)) {
            existingReference.paths.push(file.path)
          }
        } else {
          referencesByKey.set(citationKey, {
            key: citationKey,
            label: citationKey,
            paths: [file.path],
          })
        }
      }

      match = citationPattern.exec(source)
    }
  })

  return Array.from(referencesByKey.values())
    .sort((left, right) => left.key.localeCompare(right.key))
}

function isTypEntry(entry) {
  return Boolean(
    entry
    && entry.kind === 'file'
    && !entry.is_binary
    && `${entry.path || ''}`.toLowerCase().endsWith('.typ'),
  )
}

function findPreferredTypEntry(entries, preferredPath = '') {
  const typEntries = entries.filter((entry) => isTypEntry(entry))
  if (typEntries.length === 0) return null

  return typEntries.find((entry) => entry.path === preferredPath)
    || typEntries.find((entry) => entry.path === 'main.typ')
    || typEntries[0]
}

function getSelectedLineRange(source, selectionStart, selectionEnd) {
  const lineStart = source.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1
  const anchor = selectionEnd > selectionStart ? selectionEnd : selectionStart
  const lineEndIndex = source.indexOf('\n', anchor)

  return {
    lineStart,
    lineEnd: lineEndIndex === -1 ? source.length : lineEndIndex,
  }
}

function transformList(source, selectionStart, selectionEnd, prefix, emptyTemplate) {
  const { lineStart, lineEnd } = getSelectedLineRange(source, selectionStart, selectionEnd)
  const block = source.slice(lineStart, lineEnd)

  if (!block.trim()) {
    return insertTemplate(source, lineStart, lineEnd, emptyTemplate, prefix.length)
  }

  const replacement = block
    .split('\n')
    .map((line) => (line.trim() ? `${prefix}${line.replace(/^[-+]\s*/, '')}` : line))
    .join('\n')

  return {
    content: replaceSelectionRange(source, lineStart, lineEnd, replacement),
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  }
}

function transformMath(source, selectionStart, selectionEnd) {
  if (selectionStart !== selectionEnd) {
    return wrapSelection(source, selectionStart, selectionEnd, '$', '$')
  }

  return insertTemplate(source, selectionStart, selectionEnd, '$$', 1)
}

function transformHeading(source, selectionStart, selectionEnd) {
  const { lineStart, lineEnd } = getSelectedLineRange(source, selectionStart, selectionEnd)
  const block = source.slice(lineStart, lineEnd)

  if (!block.trim()) {
    return insertTemplate(source, lineStart, lineEnd, '= ', 2)
  }

  const replacement = block
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line

      const match = line.match(/^(\s*)(=+)\s*(.*)$/)
      if (match) {
        const [, indent, markers, text] = match
        return `${indent}${markers}=${text ? ` ${text}` : ' '}`
      }

      const leadingWhitespace = line.match(/^\s*/)?.[0] || ''
      return `${leadingWhitespace}= ${line.trimStart()}`
    })
    .join('\n')

  return {
    content: replaceSelectionRange(source, lineStart, lineEnd, replacement),
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  }
}

function FontPicker({
  isEditableDocument,
  isOpen,
  label,
  onMouseDown,
  onSelect,
  onToggle,
  options,
  selectedFont,
}) {
  return (
    <div style={styles.fontPicker}>
      <div style={styles.fontMenuLabel}>{label}</div>
      <div
        onClick={() => {
          if (!isEditableDocument) return
          onToggle()
        }}
        onMouseDown={onMouseDown}
        onKeyDown={(event) => {
          if (!isEditableDocument) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
        role="button"
        style={{
          ...styles.fontPickerTrigger,
          ...(!isEditableDocument ? styles.fontPickerTriggerDisabled : null),
        }}
        tabIndex={isEditableDocument ? 0 : -1}
      >
        <span
          style={{
            ...styles.fontPickerValue,
            ...(selectedFont ? { fontFamily: `"${selectedFont}", "Noto Sans CJK SC", "Liberation Sans", sans-serif` } : null),
          }}
        >
          {selectedFont || 'System default'}
        </span>
        <span style={styles.fontPickerChevron}>{isOpen ? '▴' : '▾'}</span>
      </div>
      {isOpen ? (
        <div style={styles.fontOptionList}>
          <div
            onClick={() => onSelect('')}
            onMouseDown={onMouseDown}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect('')
              }
            }}
            role="button"
            style={{
              ...styles.fontOptionItem,
              ...(!selectedFont ? styles.fontOptionItemActive : null),
            }}
            tabIndex={0}
          >
            System default
          </div>
          {options.map((fontName) => (
            <div
              key={fontName}
              onClick={() => onSelect(fontName)}
              onMouseDown={onMouseDown}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(fontName)
                }
              }}
              role="button"
              style={{
                ...styles.fontOptionItem,
                ...(selectedFont === fontName ? styles.fontOptionItemActive : null),
                fontFamily: `"${fontName}", "Noto Sans CJK SC", "Liberation Sans", sans-serif`,
              }}
              tabIndex={0}
              title={fontName}
            >
              {fontName}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function Editor({ projectId, onBack }) {
  const gutterRef = useRef(null)
  const textareaRef = useRef(null)
  const statusTimerRef = useRef(null)
  const pendingCursorJumpRef = useRef(null)
  const pendingEditorSelectionRef = useRef(null)
  const dragStateRef = useRef(null)
  const previewApiRef = useRef(null)
  const fontButtonRef = useRef(null)
  const fontMenuRef = useRef(null)
  const referenceButtonRef = useRef(null)
  const referenceMenuRef = useRef(null)
  const [files, setFiles] = useState([])
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [currentFile, setCurrentFile] = useState(null)
  const [content, setContent] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [sidebarMode, setSidebarMode] = useState('files')
  const [editorZoom, setEditorZoom] = useState(1)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [isPreviewDetached, setIsPreviewDetached] = useState(false)
  const [editorWheelElement, setEditorWheelElement] = useState(null)
  const [previewWheelElement, setPreviewWheelElement] = useState(null)
  const [floatingPreviewPosition, setFloatingPreviewPosition] = useState({ top: 88, right: 28 })
  const [jumpNonce, setJumpNonce] = useState(0)
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false)
  const [fontMenuPosition, setFontMenuPosition] = useState({ top: 0, left: 0 })
  const [isReferenceMenuOpen, setIsReferenceMenuOpen] = useState(false)
  const [referenceMenuPosition, setReferenceMenuPosition] = useState({ top: 0, left: 0 })
  const [referenceOptions, setReferenceOptions] = useState([])
  const [isReferenceOptionsLoading, setIsReferenceOptionsLoading] = useState(false)
  const [availableFonts, setAvailableFonts] = useState([])
  const [openFontPicker, setOpenFontPicker] = useState('')
  const [activePreviewPath, setActivePreviewPath] = useState('main.typ')
  const [previewStatus, setPreviewStatus] = useState({ kind: 'Idle' })
  const [previewOutline, setPreviewOutline] = useState([])
  const editorFontSize = Math.round(15 * editorZoom * 10) / 10
  const editorLineHeight = Math.round(24 * editorZoom * 10) / 10
  const lineNumberFontSize = Math.round(13 * editorZoom * 10) / 10
  const gutterWidth = Math.max(52, Math.round(52 * editorZoom))

  function showStatus(message, duration = 0) {
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current)
      statusTimerRef.current = null
    }

    setStatusMessage(message)

    if (duration > 0) {
      statusTimerRef.current = window.setTimeout(() => {
        setStatusMessage('')
        statusTimerRef.current = null
      }, duration)
    }
  }

  async function selectEntry(entry) {
    setSelectedEntry(entry)
    if (isTypEntry(entry)) {
      setActivePreviewPath(entry.path)
    }

    if (entry.kind === 'folder' || entry.is_binary) {
      setCurrentFile(null)
      setContent('')
      return
    }

    const data = await getFileContent(entry.id)
    setCurrentFile(data)
    setContent(data.content)
  }

  async function refreshFiles(preferredPath = '') {
    const nextFiles = await listProjectFiles(projectId)
    setFiles(nextFiles)

    const nextSelectedEntry = preferredPath
      ? nextFiles.find((entry) => entry.path === preferredPath)
      : nextFiles.find((entry) => entry.path === selectedEntry?.path)

    const fallbackEntry =
      nextSelectedEntry ||
      nextFiles.find((entry) => entry.path === 'main.typ') ||
      nextFiles.find((entry) => entry.kind === 'file') ||
      nextFiles[0] ||
      null

    if (!fallbackEntry) {
      setSelectedEntry(null)
      setCurrentFile(null)
      setContent('')
      setActivePreviewPath('')
      return
    }

    const nextPreviewEntry = findPreferredTypEntry(nextFiles, preferredPath || activePreviewPath || fallbackEntry.path)
    setActivePreviewPath(nextPreviewEntry?.path || '')

    await selectEntry(fallbackEntry)
  }

  useEffect(() => {
    let isCancelled = false

    async function loadInitialFiles() {
      const nextFiles = await listProjectFiles(projectId)
      if (isCancelled) return

      setFiles(nextFiles)

      const fallbackEntry =
        nextFiles.find((entry) => entry.path === 'main.typ') ||
        nextFiles.find((entry) => entry.kind === 'file') ||
        nextFiles[0] ||
        null

      if (!fallbackEntry) {
        setSelectedEntry(null)
        setCurrentFile(null)
        setContent('')
        setActivePreviewPath('')
        return
      }

      const fallbackPreviewEntry = findPreferredTypEntry(nextFiles, fallbackEntry.path)
      setActivePreviewPath(fallbackPreviewEntry?.path || '')

      setSelectedEntry(fallbackEntry)

      if (fallbackEntry.kind === 'folder' || fallbackEntry.is_binary) {
        setCurrentFile(null)
        setContent('')
        return
      }

      const data = await getFileContent(fallbackEntry.id)
      if (isCancelled) return

      setCurrentFile(data)
      setContent(data.content)
    }

    void loadInitialFiles()

    return () => {
      isCancelled = true
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current)
      }
    }
  }, [projectId])

  useEffect(() => {
    let isCancelled = false

    async function loadAvailableFonts() {
      try {
        const payload = await listAvailableFonts()
        if (isCancelled) return
        setAvailableFonts(Array.isArray(payload.fonts) ? payload.fonts : [])
      } catch {
        if (isCancelled) return
        setAvailableFonts([])
      }
    }

    void loadAvailableFonts()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    async function loadPreviewStatus() {
      const previewEntry = findPreferredTypEntry(files, activePreviewPath)
      if (!previewEntry?.path) {
        setPreviewStatus({ kind: 'Idle' })
        setPreviewOutline([])
        return
      }

      try {
        const payload = await getProjectPreviewStatus(projectId, { entrypoint: previewEntry.path })
        if (isCancelled) return

        setPreviewStatus(payload?.status && typeof payload.status === 'object' ? payload.status : { kind: 'Idle' })
        setPreviewOutline(Array.isArray(payload?.outline) ? payload.outline : [])
      } catch {
        if (isCancelled) return

        setPreviewStatus({ kind: 'Unavailable' })
        setPreviewOutline([])
      }
    }

    void loadPreviewStatus()
    const intervalId = window.setInterval(() => {
      void loadPreviewStatus()
    }, 1200)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [activePreviewPath, files, projectId])

  async function saveAndPreview() {
    if (!currentFile) return
    try {
      showStatus('Saving...')
      await updateFileContent(currentFile.id, content)
      setCurrentFile((current) => (current ? { ...current, content } : current))
      showStatus('Saved', 3000)
    } catch (error) {
      showStatus(error.message || 'Failed to save')
    }
  }

  const handleSaveShortcut = useEffectEvent(() => {
    void saveAndPreview()
  })

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSaveShortcut()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  async function handleCreateFile(path) {
    const entry = await createProjectFile(projectId, path)
    await refreshFiles(entry.path)
    showStatus(`Created ${entry.path}`, 2000)
  }

  async function handleCreateFolder(path) {
    const entry = await createProjectFolder(projectId, path)
    await refreshFiles(entry.path)
    showStatus(`Created ${entry.path}`, 2000)
  }

  async function handleUploadFiles(uploadFiles, options) {
    await uploadProjectFiles(projectId, uploadFiles, options)
    const preferredPath = options.parentPath || selectedEntry?.path || ''
    await refreshFiles(preferredPath)
    showStatus(`Uploaded ${uploadFiles.length} file${uploadFiles.length > 1 ? 's' : ''}`, 2500)
  }

  async function handleRenameEntry(entry, nextPath) {
    const updatedEntry = await renameProjectEntry(entry.id, nextPath)
    await refreshFiles(updatedEntry.path)
    showStatus(`Renamed to ${updatedEntry.path}`, 2500)
  }

  async function handleDeleteEntry(entry) {
    await deleteProjectEntry(entry.id)
    await refreshFiles(getParentPath(entry.path))
    showStatus(`Deleted ${entry.path}`, 2500)
  }

  function handleDownloadEntry(entry) {
    if (entry.kind !== 'file') return
    downloadProjectFile(entry.id, entry.name)
    showStatus(`Downloading ${entry.name}`, 2000)
  }

  async function handleSearch(query) {
    return searchProjectFiles(projectId, query)
  }

  async function handleOpenSearchResult(result) {
    const matchingEntry = files.find((entry) => entry.id === result.file_id)
    if (!matchingEntry) return
    pendingCursorJumpRef.current = {
      fileId: result.file_id,
      start: result.start,
      end: result.end,
      lineNumber: result.line_number,
    }
    await selectEntry(matchingEntry)
  }

  async function handlePreviewJump(message) {
    const filepath = message?.filepath
    const start = Array.isArray(message?.start) ? message.start : null
    const end = Array.isArray(message?.end) ? message.end : start
    if (!filepath || !start || !end) return

    const relativePath = normalizePreviewFilePath(filepath, projectId)
    const matchingEntry = files.find((entry) => entry.path === relativePath)
    if (!matchingEntry || matchingEntry.kind !== 'file' || matchingEntry.is_binary) return

    pendingCursorJumpRef.current = {
      path: relativePath,
      startLine: start[0],
      startCharacter: start[1],
      endLine: end[0],
      endCharacter: end[1],
    }
    setJumpNonce((current) => current + 1)

    if (currentFile?.path === relativePath) {
      return
    }

    await selectEntry(matchingEntry)
  }

  async function handleSidebarLocationJump(location) {
    if (!location?.path || !Array.isArray(location?.start)) return

    const matchingEntry = files.find((entry) => entry.path === location.path)
    if (!matchingEntry || matchingEntry.kind !== 'file' || matchingEntry.is_binary) return

    pendingCursorJumpRef.current = {
      path: location.path,
      startLine: location.start[0],
      startCharacter: location.start[1],
      endLine: location.end?.[0] ?? location.start[0],
      endCharacter: location.end?.[1] ?? location.start[1],
    }
    setJumpNonce((current) => current + 1)

    if (currentFile?.path === location.path) return

    await selectEntry(matchingEntry)
  }

  async function handleOutlineItemSelect(item) {
    if (item?.location) {
      await handleSidebarLocationJump(item.location)
      return
    }

    const outlineTitle = `${item?.title || item?.text || item?.label || ''}`.trim()
    if (!outlineTitle) return

    const candidateEntries = [
      ...(selectedEntry?.kind === 'file' && !selectedEntry?.is_binary ? [selectedEntry] : []),
      ...files.filter((entry) => (
        entry.kind === 'file'
        && !entry.is_binary
        && entry.id !== selectedEntry?.id
      )),
    ]

    for (const entry of candidateEntries) {
      let source = ''

      if (currentFile?.id === entry.id) {
        source = content
      } else {
        try {
          const fileData = await getFileContent(entry.id)
          source = fileData.content || ''
        } catch {
          continue
        }
      }

      const match = findOutlineHeadingInSource(source, outlineTitle)
      if (!match) continue

      pendingCursorJumpRef.current = {
        fileId: entry.id,
        start: match.start,
        end: match.end,
        lineNumber: match.lineNumber,
      }

      if (currentFile?.id === entry.id) {
        setJumpNonce((current) => current + 1)
        return
      }

      await selectEntry(entry)
      return
    }
  }

  function handleEditorDoubleClick() {
    const textarea = textareaRef.current
    if (!textarea || !currentFile) return

    const cursor = textarea.selectionStart
    const lineStart = textarea.value.lastIndexOf('\n', Math.max(cursor - 1, 0)) + 1
    const lineNumber = textarea.value.slice(0, cursor).split('\n').length - 1
    const character = cursor - lineStart
    previewApiRef.current?.revealCursor({
      path: currentFile.path,
      line: lineNumber,
      character,
    })
  }

  useEffect(() => {
    const pendingCursorJump = pendingCursorJumpRef.current
    const pendingEditorSelection = pendingEditorSelectionRef.current
    if ((!pendingCursorJump && !pendingEditorSelection) || !currentFile || !textareaRef.current) {
      return
    }

    const textarea = textareaRef.current

    if (pendingCursorJump) {
      const matchesSearchJump =
        pendingCursorJump.fileId != null && currentFile.id === pendingCursorJump.fileId
      const matchesPreviewJump =
        pendingCursorJump.path != null && currentFile.path === pendingCursorJump.path

      if (!matchesSearchJump && !matchesPreviewJump) {
        return
      }

      const selectionStart = matchesPreviewJump
        ? getSelectionOffset(content, pendingCursorJump.startLine, pendingCursorJump.startCharacter)
        : getSelectionOffset(content, Math.max(pendingCursorJump.lineNumber - 1, 0), pendingCursorJump.start)
      const selectionEnd = matchesPreviewJump
        ? getSelectionOffset(content, pendingCursorJump.endLine, pendingCursorJump.endCharacter)
        : getSelectionOffset(content, Math.max(pendingCursorJump.lineNumber - 1, 0), pendingCursorJump.end)

      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)

      const lineHeight = editorLineHeight
      const lineNumber = matchesPreviewJump ? pendingCursorJump.startLine + 1 : pendingCursorJump.lineNumber
      const scrollTop = Math.max((lineNumber - 3) * lineHeight, 0)
      textarea.scrollTop = scrollTop
      if (gutterRef.current) {
        gutterRef.current.scrollTop = scrollTop
      }

      previewApiRef.current?.revealCursor({
        path: currentFile.path,
        line: matchesPreviewJump ? pendingCursorJump.startLine : Math.max(pendingCursorJump.lineNumber - 1, 0),
        character: matchesPreviewJump ? pendingCursorJump.startCharacter : pendingCursorJump.start,
      })

      pendingCursorJumpRef.current = null
      return
    }

    textarea.focus()
    textarea.setSelectionRange(pendingEditorSelection.start, pendingEditorSelection.end)
    if (typeof pendingEditorSelection.scrollTop === 'number') {
      textarea.scrollTop = pendingEditorSelection.scrollTop
      if (gutterRef.current) {
        gutterRef.current.scrollTop = pendingEditorSelection.scrollTop
      }
    }
    pendingEditorSelectionRef.current = null
  }, [content, currentFile, editorLineHeight, jumpNonce])

  async function handleDownload() {
    if (!activePreviewEntry?.path) {
      showStatus('No .typ file selected for export', 2500)
      return
    }

    try {
      if (currentFile?.path === activePreviewEntry.path && !selectedEntry?.is_binary) {
        await updateFileContent(currentFile.id, content)
        setCurrentFile((current) => (current ? { ...current, content } : current))
      }

      showStatus(`Exporting ${activePreviewEntry.name}...`)
      await downloadProjectPdf(projectId, {
        entrypoint: activePreviewEntry.path,
        filename: `${activePreviewEntry.name.replace(/\.typ$/i, '')}.pdf`,
      })
      showStatus(`Exported ${activePreviewEntry.name}`, 3000)
    } catch (error) {
      showStatus(error.message || 'Failed to export PDF')
    }
  }

  function changePreviewZoom(delta) {
    setPreviewZoom((current) => getAdjacentPreviewZoom(current, delta))
  }

  function resetPreviewZoom() {
    setPreviewZoom(1)
  }

  function resetEditorZoom() {
    setEditorZoom(1)
  }

  function handlePreviewZoomChange(nextZoom) {
    setPreviewZoom(findNearestPreviewZoom(nextZoom))
  }

  function changeEditorZoom(delta) {
    setEditorZoom((current) => getAdjacentPreviewZoom(current, delta))
  }

  const handlePreviewWheel = useEffectEvent((event) => {
    if (!event.ctrlKey && !event.metaKey) return

    event.preventDefault()
    changePreviewZoom(event.deltaY < 0 ? 1 : -1)
  })

  const handleEditorWheel = useEffectEvent((event) => {
    if (!event.ctrlKey && !event.metaKey) return

    event.preventDefault()
    changeEditorZoom(event.deltaY < 0 ? 1 : -1)
  })

  useEffect(() => {
    if (!editorWheelElement) return undefined

    const handleNativeWheel = (event) => {
      handleEditorWheel(event)
    }

    editorWheelElement.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => {
      editorWheelElement.removeEventListener('wheel', handleNativeWheel)
    }
  }, [editorWheelElement])

  useEffect(() => {
    if (!previewWheelElement) return undefined

    const handleNativeWheel = (event) => {
      handlePreviewWheel(event)
    }

    previewWheelElement.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => {
      previewWheelElement.removeEventListener('wheel', handleNativeWheel)
    }
  }, [previewWheelElement])

  useEffect(() => {
    if (!isPreviewDetached) {
      dragStateRef.current = null
      return undefined
    }

    const handleMouseMove = (event) => {
      const dragState = dragStateRef.current
      if (!dragState) return

      setFloatingPreviewPosition({
        top: Math.max(event.clientY - dragState.offsetY, 64),
        right: Math.max(window.innerWidth - event.clientX - dragState.offsetRight, 20),
      })
    }

    const handleMouseUp = () => {
      dragStateRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isPreviewDetached])

  useEffect(() => {
    if (!isFontMenuOpen) return undefined

    const updateFontMenuPosition = () => {
      const buttonRect = fontButtonRef.current?.getBoundingClientRect()
      if (!buttonRect) return

      setFontMenuPosition({
        top: buttonRect.bottom + 8,
        left: buttonRect.left,
      })
    }

    updateFontMenuPosition()

    const handlePointerDown = (event) => {
      if (fontMenuRef.current?.contains(event.target) || fontButtonRef.current?.contains(event.target)) return
      setIsFontMenuOpen(false)
      setOpenFontPicker('')
    }

    window.addEventListener('resize', updateFontMenuPosition)
    window.addEventListener('scroll', updateFontMenuPosition, true)
    window.addEventListener('mousedown', handlePointerDown)

    return () => {
      window.removeEventListener('resize', updateFontMenuPosition)
      window.removeEventListener('scroll', updateFontMenuPosition, true)
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isFontMenuOpen])

  useEffect(() => {
    if (!isReferenceMenuOpen) return undefined

    const updateReferenceMenuPosition = () => {
      const buttonRect = referenceButtonRef.current?.getBoundingClientRect()
      if (!buttonRect) return

      setReferenceMenuPosition({
        top: buttonRect.bottom + 8,
        left: buttonRect.left,
      })
    }

    updateReferenceMenuPosition()

    const handlePointerDown = (event) => {
      if (
        referenceMenuRef.current?.contains(event.target)
        || referenceButtonRef.current?.contains(event.target)
      ) {
        return
      }

      setIsReferenceMenuOpen(false)
    }

    window.addEventListener('resize', updateReferenceMenuPosition)
    window.addEventListener('scroll', updateReferenceMenuPosition, true)
    window.addEventListener('mousedown', handlePointerDown)

    return () => {
      window.removeEventListener('resize', updateReferenceMenuPosition)
      window.removeEventListener('scroll', updateReferenceMenuPosition, true)
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isReferenceMenuOpen])

  useEffect(() => {
    if (!isReferenceMenuOpen) return undefined

    let isCancelled = false

    async function loadReferenceOptions() {
      setIsReferenceOptionsLoading(true)

      const bibliographyEntries = files.filter((entry) => (
        entry.kind === 'file'
        && !entry.is_binary
        && `${entry.path || ''}`.toLowerCase().endsWith('.bib')
      ))

      if (bibliographyEntries.length === 0) {
        setReferenceOptions([])
        setIsReferenceOptionsLoading(false)
        return
      }

      const bibliographyFiles = await Promise.all(
        bibliographyEntries.map(async (entry) => {
          try {
            if (currentFile?.id === entry.id) {
              return { path: entry.path, content }
            }

            const fileData = await getFileContent(entry.id)
            return { path: entry.path, content: fileData.content || '' }
          } catch {
            return null
          }
        }),
      )

      if (isCancelled) return

      setReferenceOptions(parseBibReferenceOptions(bibliographyFiles.filter(Boolean)))
      setIsReferenceOptionsLoading(false)
    }

    void loadReferenceOptions()

    return () => {
      isCancelled = true
    }
  }, [isReferenceMenuOpen, files, currentFile?.id, content])

  const lineCount = useMemo(
    () => Math.max(content.split('\n').length, 1),
    [content],
  )
  const fontOptions = useMemo(() => buildFontOptions(availableFonts), [availableFonts])
  const fontSelection = useMemo(
    () => parseFontSelection(content, fontOptions),
    [content, fontOptions],
  )
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1),
    [lineCount],
  )

  const activePreviewEntry = useMemo(
    () => findPreferredTypEntry(files, activePreviewPath),
    [activePreviewPath, files],
  )
  const previewUrl = activePreviewEntry
    ? getProjectPreviewUrl(projectId, { entrypoint: activePreviewEntry.path })
    : ''
  const selectedFilePreviewUrl = selectedEntry?.kind === 'file'
    ? getProjectFileUrl(selectedEntry.id)
    : ''
  const currentPathLabel = currentFile?.path || selectedEntry?.path || 'Typst Playground'
  const currentEntryName = selectedEntry?.name || 'Welcome'
  const previewEntryName = activePreviewEntry?.name || 'No preview'
  const editorZoomLabel = `${Math.round(editorZoom * 100)}%`
  const previewZoomLabel = `${Math.round(previewZoom * 100)}%`
  const isEditableDocument = Boolean(currentFile && selectedEntry?.kind === 'file' && !selectedEntry?.is_binary)
  const diagnostics = useMemo(
    () => normalizeDiagnostics(previewStatus, projectId),
    [previewStatus, projectId],
  )
  const errorCount = useMemo(
    () => diagnostics.filter((diagnostic) => !`${diagnostic.severity || ''}`.toLowerCase().includes('warn')
      && !`${diagnostic.severity || ''}`.toLowerCase().includes('info')).length,
    [diagnostics],
  )
  const outlineItems = useMemo(
    () => normalizeOutlineItems(previewOutline, projectId),
    [previewOutline, projectId],
  )
  const bibliographyFileCount = useMemo(
    () => files.filter((entry) => (
      entry.kind === 'file'
      && !entry.is_binary
      && `${entry.path || ''}`.toLowerCase().endsWith('.bib')
    )).length,
    [files],
  )

  const togglePreviewDetach = () => {
    setIsPreviewDetached((current) => !current)
  }

  const startFloatingPreviewDrag = (event) => {
    dragStateRef.current = {
      offsetY: event.clientY - floatingPreviewPosition.top,
      offsetRight: window.innerWidth - event.clientX - floatingPreviewPosition.right,
    }
  }

  const applyFontSelection = (nextEnglishFont, nextChineseFont) => {
    if (!isEditableDocument) return

    const nextFontValue = buildTypstFontValue(nextEnglishFont, nextChineseFont)

    setContent((current) => updateTextFontDirective(current, nextFontValue))
    showStatus(nextFontValue ? 'Updated text font directive' : 'Cleared text font directive', 2000)
  }

  const handleEnglishFontSelect = (fontName) => {
    applyFontSelection(fontName, fontSelection.chineseFont)
    setOpenFontPicker('')
  }

  const handleChineseFontSelect = (fontName) => {
    applyFontSelection(fontSelection.englishFont, fontName)
    setOpenFontPicker('')
  }

  const insertReference = (citationKey = '') => {
    applyEditorTransformation(
      (source, selectionStart, selectionEnd) => insertReferenceTemplate(
        source,
        selectionStart,
        selectionEnd,
        citationKey,
      ),
      citationKey ? `Inserted @${citationKey}` : 'Inserted reference marker',
    )
    setIsReferenceMenuOpen(false)
  }

  const applyEditorTransformation = (transformer, statusText) => {
    if (!isEditableDocument || !textareaRef.current) return

    const textarea = textareaRef.current
    const selectionStart = textarea.selectionStart
    const selectionEnd = textarea.selectionEnd
    const nextState = transformer(content, selectionStart, selectionEnd)
    if (!nextState) return

    pendingEditorSelectionRef.current = {
      start: nextState.selectionStart,
      end: nextState.selectionEnd,
      scrollTop: textarea.scrollTop,
    }
    setContent(nextState.content)
    if (statusText) {
      showStatus(statusText, 1500)
    }
  }

  const handleEditorToolClick = (toolId) => {
    switch (toolId) {
      case 'bold':
        applyEditorTransformation(
          (source, selectionStart, selectionEnd) => insertPairedMarkers(source, selectionStart, selectionEnd, '*'),
          'Inserted bold markers',
        )
        return
      case 'italic':
        applyEditorTransformation(
          (source, selectionStart, selectionEnd) => insertPairedMarkers(source, selectionStart, selectionEnd, '_'),
          'Inserted italic markers',
        )
        return
      case 'underline':
        applyEditorTransformation(
          (source, selectionStart, selectionEnd) => wrapSelection(source, selectionStart, selectionEnd, '#underline[', ']', ''),
          'Inserted underline',
        )
        return
      case 'heading':
        applyEditorTransformation(transformHeading, 'Updated heading')
        return
      case 'bullet':
        applyEditorTransformation(
          (source, selectionStart, selectionEnd) => transformList(source, selectionStart, selectionEnd, '- ', '- '),
          'Inserted bullet list',
        )
        return
      case 'align':
        applyEditorTransformation(
          (source, selectionStart, selectionEnd) => transformList(source, selectionStart, selectionEnd, '+ ', '+ '),
          'Inserted numbered list',
        )
        return
      case 'math':
        applyEditorTransformation(
          transformMath,
          'Inserted formula markers',
        )
        return
      case 'code':
        applyEditorTransformation(
          (source, selectionStart, selectionEnd) => insertTemplate(
            source,
            selectionStart,
            selectionEnd,
            PYTHON_CODE_BLOCK_TEMPLATE,
            '```python\n'.length,
          ),
          'Inserted Python code block',
        )
        return
      case 'reference':
        insertReference('')
        return
      default:
        return
    }
  }

  const renderPreviewTools = () => (
    <div style={styles.panelTools}>
      <button onClick={resetPreviewZoom} style={styles.previewChip}>⟲</button>
      <button onClick={() => changePreviewZoom(-1)} style={styles.previewChip}>−</button>
      <button style={styles.previewChipLabel}>{previewZoomLabel}</button>
      <button onClick={() => changePreviewZoom(1)} style={styles.previewChip}>+</button>
      <button
        onClick={togglePreviewDetach}
        style={styles.previewChip}
        title={isPreviewDetached ? 'Dock preview' : 'Open floating preview'}
      >
        {isPreviewDetached ? '⇲' : '⧉'}
      </button>
    </div>
  )

  const renderPreviewViewport = () => (
    <div ref={setPreviewWheelElement} style={styles.previewFrame}>
      {activePreviewEntry ? (
        <TinymistPreview
          ref={previewApiRef}
          key={`${projectId}-${activePreviewEntry.path}-${isPreviewDetached ? 'floating' : 'embedded'}`}
          onJumpToSource={handlePreviewJump}
          onZoomChange={handlePreviewZoomChange}
          src={previewUrl}
          zoom={previewZoom}
        />
      ) : (
        <div style={styles.previewPlaceholder}>Select a `.typ` file to preview.</div>
      )}
    </div>
  )

  const handleRailClick = (itemId) => {
    if (!['files', 'search', 'outline', 'errors'].includes(itemId)) return

    setSidebarMode((current) => (current === itemId ? '' : itemId))
  }

  const toggleFontMenu = () => {
    setIsReferenceMenuOpen(false)
    setIsFontMenuOpen((current) => {
      const nextValue = !current
      if (!nextValue) {
        setOpenFontPicker('')
      }
      return nextValue
    })
  }

  const handleFontMenuMouseDown = (event) => {
    event.preventDefault()
  }

  const toggleFontPicker = (pickerId) => {
    setOpenFontPicker((current) => (current === pickerId ? '' : pickerId))
  }

  const toggleReferenceMenu = () => {
    setIsFontMenuOpen(false)
    setOpenFontPicker('')
    setIsReferenceMenuOpen((current) => !current)
  }

  return (
    <div style={styles.appShell}>
      <div style={styles.workspace}>
        <div style={styles.leftRail}>
          <div style={styles.leftRailTop}>
            <div style={styles.brandMark}>t</div>
            {RAIL_ITEMS.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  handleRailClick(item.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleRailClick(item.id)
                  }
                }}
                role="button"
                style={{
                  ...styles.railButton,
                  ...(item.id === sidebarMode ? styles.railButtonActive : null),
                }}
                tabIndex={0}
                title={item.title}
              >
                {item.label}
                {item.id === 'errors' && errorCount > 0 ? (
                  <span style={styles.railBadge}>{errorCount > 99 ? '99+' : errorCount}</span>
                ) : null}
              </div>
            ))}
          </div>
          <div style={styles.leftRailBottom}>typst</div>
        </div>

        {sidebarMode === 'files' ? (
          <FileSidebar
            entries={files}
            onClose={() => setSidebarMode('')}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onDeleteEntry={handleDeleteEntry}
            onDownloadEntry={handleDownloadEntry}
            onRenameEntry={handleRenameEntry}
            onSelectEntry={selectEntry}
            onUploadFiles={handleUploadFiles}
            selectedEntry={selectedEntry}
          />
        ) : null}

        {sidebarMode === 'search' ? (
          <SearchSidebar
            onClose={() => setSidebarMode('')}
            onOpenResult={handleOpenSearchResult}
            onSearch={handleSearch}
          />
        ) : null}

        {sidebarMode === 'outline' ? (
          <OutlineSidebar
            items={outlineItems}
            onClose={() => setSidebarMode('')}
            onSelectItem={(item) => void handleOutlineItemSelect(item)}
          />
        ) : null}

        {sidebarMode === 'errors' ? (
          <DiagnosticsSidebar
            diagnostics={diagnostics}
            onClose={() => setSidebarMode('')}
            onSelectDiagnostic={(diagnostic) => void handleSidebarLocationJump(diagnostic.location)}
            statusKind={previewStatus?.kind}
          />
        ) : null}

        <div style={styles.mainStage}>
          <EditorToolbar
            compileResult={statusMessage}
            currentPath={currentPathLabel}
            onBack={onBack}
            onDownload={handleDownload}
            onSavePreview={saveAndPreview}
          />

          <div style={styles.contentRow}>
            <section style={{ ...styles.editorColumn, ...(isPreviewDetached ? styles.editorColumnExpanded : null) }}>
              <div style={styles.panelToolbar}>
                <div style={styles.panelTools}>
                  <button onClick={resetEditorZoom} style={styles.previewChip} title="Reset editor zoom" type="button">⟲</button>
                  <button onClick={() => changeEditorZoom(-1)} style={styles.previewChip} title="Zoom out editor" type="button">−</button>
                  <button style={styles.previewChipLabel} title="Editor zoom" type="button">{editorZoomLabel}</button>
                  <button onClick={() => changeEditorZoom(1)} style={styles.previewChip} title="Zoom in editor" type="button">+</button>
                  <div ref={fontMenuRef} style={styles.fontMenuShell}>
                    <div
                      ref={fontButtonRef}
                      onClick={toggleFontMenu}
                      onMouseDown={handleFontMenuMouseDown}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          toggleFontMenu()
                        }
                      }}
                      role="button"
                      style={{
                        ...styles.toolbarRailButton,
                        ...(isFontMenuOpen ? styles.toolbarRailButtonActive : null),
                      }}
                      tabIndex={0}
                      title={isEditableDocument ? 'Set fonts' : 'Open font menu'}
                    >
                      T
                    </div>
                    {isFontMenuOpen ? (
                      <div
                        style={{
                          ...styles.fontMenuPanel,
                          top: `${fontMenuPosition.top}px`,
                          left: `${fontMenuPosition.left}px`,
                        }}
                      >
                        {!isEditableDocument ? (
                          <div style={styles.fontMenuNotice}>
                            请选择一个可编辑的 `.typ` 文件后再设置字体。
                          </div>
                        ) : null}
                        <FontPicker
                          isEditableDocument={isEditableDocument}
                          isOpen={openFontPicker === 'english'}
                          label="English"
                          onMouseDown={handleFontMenuMouseDown}
                          onSelect={handleEnglishFontSelect}
                          onToggle={() => toggleFontPicker('english')}
                          options={fontOptions.englishFonts}
                          selectedFont={fontSelection.englishFont}
                        />
                        <FontPicker
                          isEditableDocument={isEditableDocument}
                          isOpen={openFontPicker === 'chinese'}
                          label="Chinese"
                          onMouseDown={handleFontMenuMouseDown}
                          onSelect={handleChineseFontSelect}
                          onToggle={() => toggleFontPicker('chinese')}
                          options={fontOptions.chineseFonts}
                          selectedFont={fontSelection.chineseFont}
                        />
                      </div>
                    ) : null}
                  </div>
                  {EDITOR_TOOL_ITEMS.filter((item) => item.id !== 'font').map((item) => (
                    item.id === 'reference' ? (
                      <div key={item.id} ref={referenceMenuRef} style={styles.fontMenuShell}>
                        <button
                          ref={referenceButtonRef}
                          onClick={toggleReferenceMenu}
                          onMouseDown={handleFontMenuMouseDown}
                          style={{
                            ...styles.toolChip,
                            ...(isReferenceMenuOpen ? styles.toolbarRailButtonActive : null),
                          }}
                          title={item.title}
                          type="button"
                        >
                          {item.label}
                        </button>
                        {isReferenceMenuOpen ? (
                          <div
                            style={{
                              ...styles.referenceMenuPanel,
                              top: `${referenceMenuPosition.top}px`,
                              left: `${referenceMenuPosition.left}px`,
                            }}
                          >
                            {!isEditableDocument ? (
                              <div style={styles.fontMenuNotice}>
                                请选择一个可编辑的 `.typ` 文件后再插入引用。
                              </div>
                            ) : null}
                            <div style={styles.referenceMenuLabel}>References</div>
                            <div style={styles.referenceOptionList}>
                              <div
                                onClick={() => insertReference('')}
                                onMouseDown={handleFontMenuMouseDown}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    insertReference('')
                                  }
                                }}
                                role="button"
                                style={{
                                  ...styles.referenceOptionItem,
                                  ...styles.referenceOptionItemPrimary,
                                }}
                                tabIndex={0}
                              >
                                <div style={styles.referenceOptionTextGroup}>
                                  <span style={styles.referenceOptionTitle}>basics</span>
                                  <span style={styles.referenceOptionMeta}>Insert `@` only</span>
                                </div>
                              </div>
                              {isReferenceOptionsLoading ? (
                                <div style={styles.fontMenuNotice}>Loading bibliography entries...</div>
                              ) : null}
                              {!isReferenceOptionsLoading && bibliographyFileCount === 0 ? (
                                <div style={styles.fontMenuNotice}>
                                  当前项目还没有 `.bib` 文件，先新增 bibliography 文件后这里才会列出可引用项。
                                </div>
                              ) : null}
                              {!isReferenceOptionsLoading && bibliographyFileCount > 0 && referenceOptions.length === 0 ? (
                                <div style={styles.fontMenuNotice}>
                                  已检测到 `.bib` 文件，但暂时没有解析到可引用的 key。
                                </div>
                              ) : null}
                              {referenceOptions.map((option) => (
                                <div
                                  key={`${option.key}-${option.paths.join('|')}`}
                                  onClick={() => insertReference(option.key)}
                                  onMouseDown={handleFontMenuMouseDown}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault()
                                      insertReference(option.key)
                                    }
                                  }}
                                  role="button"
                                  style={styles.referenceOptionItem}
                                  tabIndex={0}
                                  title={`Insert @${option.key}`}
                                >
                                  <div style={styles.referenceOptionTextGroup}>
                                    <span style={styles.referenceOptionTitle}>{option.label}</span>
                                    <span style={styles.referenceOptionMeta}>{option.paths.join(', ')}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <button
                        key={item.id}
                        onClick={() => handleEditorToolClick(item.id)}
                        onMouseDown={handleFontMenuMouseDown}
                        style={styles.toolChip}
                        title={item.title}
                        type="button"
                      >
                        {item.label}
                      </button>
                    )
                  ))}
                </div>
                <div style={styles.panelMeta}>{currentEntryName}</div>
              </div>

              <div ref={setEditorWheelElement} style={styles.editorSurface}>
                {selectedEntry?.kind === 'folder' ? (
                  <div style={styles.centerPlaceholder}>
                    Folder selected. New files and uploads will be created in
                    <strong style={styles.placeholderStrong}> {selectedEntry.path}</strong>.
                  </div>
                ) : selectedEntry?.is_binary ? (
                  <FileAssetPreview
                    path={selectedEntry.path}
                    src={selectedFilePreviewUrl}
                    zoom={editorZoom}
                  />
                ) : (
                  <div
                    style={{
                      ...styles.codeFrame,
                      gridTemplateColumns: `${gutterWidth}px 1fr`,
                    }}
                  >
                    <div ref={gutterRef} style={styles.lineGutter}>
                      {lineNumbers.map((lineNumber) => (
                        <div
                          key={lineNumber}
                          style={{
                            ...styles.lineNumber,
                            height: `${editorLineHeight}px`,
                            lineHeight: `${editorLineHeight}px`,
                            fontSize: `${lineNumberFontSize}px`,
                          }}
                        >
                          {lineNumber}
                        </div>
                      ))}
                    </div>
                    <textarea
                      ref={textareaRef}
                      onChange={(event) => setContent(event.target.value)}
                      onDoubleClick={handleEditorDoubleClick}
                      onScroll={(event) => {
                        if (gutterRef.current) {
                          gutterRef.current.scrollTop = event.currentTarget.scrollTop
                        }
                      }}
                      spellCheck={false}
                      style={{
                        ...styles.textarea,
                        fontSize: `${editorFontSize}px`,
                        lineHeight: `${editorLineHeight}px`,
                      }}
                      value={content}
                    />
                  </div>
                )}
              </div>
            </section>

            {!isPreviewDetached ? (
              <section style={styles.previewColumn}>
                <div style={styles.panelToolbar}>
                  {renderPreviewTools()}
                  <div style={styles.panelMeta}>{`Preview · ${previewEntryName}`}</div>
                </div>

                {renderPreviewViewport()}
              </section>
            ) : null}
          </div>
        </div>

        {isPreviewDetached ? (
          <div
            style={{
              ...styles.floatingPreviewWindow,
              top: `${floatingPreviewPosition.top}px`,
              right: `${floatingPreviewPosition.right}px`,
            }}
          >
            <div
              onMouseDown={startFloatingPreviewDrag}
              style={{ ...styles.panelToolbar, ...styles.floatingPreviewHeader }}
            >
              {renderPreviewTools()}
              <div style={styles.floatingPreviewMeta}>
                <span style={styles.floatingDragHandle}>⋮⋮</span>
                {`Preview · ${previewEntryName}`}
              </div>
            </div>

            {renderPreviewViewport()}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const styles = {
  appShell: {
    height: '100vh',
    background: '#d9d9dd',
    padding: '0',
    color: '#242730',
    fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
  },
  workspace: {
    display: 'flex',
    height: '100%',
    width: '100%',
    background: '#d9d9dd',
  },
  leftRail: {
    width: '56px',
    background: '#f2f2f4',
    borderRight: '1px solid #d1d3d9',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 0 18px',
  },
  leftRailTop: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
  brandMark: {
    width: '32px',
    height: '32px',
    borderRadius: '10px',
    background: '#dcebfb',
    color: '#3f87ce',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: '800',
    marginBottom: '8px',
  },
  railButton: {
    position: 'relative',
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    background: 'transparent',
    color: '#5a606a',
    cursor: 'pointer',
    fontSize: '17px',
    fontWeight: '700',
    outline: 'none',
    boxShadow: 'none',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  },
  diagnosticsRailGlyph: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 0,
  },
  diagnosticsRailGlyphSvg: {
    width: '20px',
    height: '20px',
    display: 'block',
  },
  railBadge: {
    position: 'absolute',
    top: '-5px',
    right: '-7px',
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    borderRadius: '999px',
    background: '#ef4444',
    color: '#ffffff',
    fontSize: '10px',
    fontWeight: '800',
    lineHeight: '16px',
    textAlign: 'center',
    boxShadow: '0 0 0 2px #f2f2f4',
  },
  railButtonActive: {
    background: '#ffffff',
    color: '#22262f',
    boxShadow: '0 6px 14px rgba(71, 85, 105, 0.08), inset 0 0 0 1px #ced2d9',
  },
  leftRailBottom: {
    writingMode: 'vertical-rl',
    transform: 'rotate(180deg)',
    fontSize: '20px',
    fontWeight: '800',
    letterSpacing: '0.08em',
    color: '#2f3340',
    textTransform: 'lowercase',
  },
  mainStage: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  contentRow: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    padding: '14px',
    minHeight: 0,
  },
  editorColumn: {
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #d3d5da',
    background: '#f7f7f9',
  },
  editorColumnExpanded: {
    gridColumn: '1 / -1',
  },
  previewColumn: {
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #d3d5da',
    background: '#f7f7f9',
  },
  panelToolbar: {
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '0 14px',
    background: '#efeff2',
    borderBottom: '1px solid #dadce2',
    minWidth: 0,
  },
  panelTools: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'nowrap',
    overflow: 'visible',
    flexShrink: 0,
  },
  toolChip: {
    width: '30px',
    height: '30px',
    padding: '0',
    borderRadius: '8px',
    border: '1px solid #cbced6',
    background: '#ffffff',
    color: '#404552',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    outline: 'none',
    boxShadow: 'none',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  },
  listToolGlyph: {
    display: 'grid',
    gap: '1px',
    width: '9px',
  },
  listToolGlyphRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1px',
  },
  listToolGlyphMarker: {
    width: '3px',
    fontSize: '5px',
    fontWeight: '800',
    lineHeight: 1,
    textAlign: 'center',
  },
  listToolGlyphLine: {
    width: '5px',
    height: '1px',
    borderRadius: '999px',
    background: 'currentColor',
  },
  toolbarRailButton: {
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    border: '1px solid #cbced6',
    background: '#ffffff',
    color: '#404552',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '700',
    outline: 'none',
    boxShadow: 'none',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  },
  toolbarRailButtonActive: {
    background: '#ffffff',
    color: '#22262f',
    boxShadow: '0 6px 14px rgba(71, 85, 105, 0.08), inset 0 0 0 1px #ced2d9',
  },
  fontMenuShell: {
    position: 'relative',
  },
  fontMenuPanel: {
    position: 'fixed',
    width: '260px',
    display: 'grid',
    gap: '10px',
    padding: '12px',
    borderRadius: '12px',
    border: '1px solid #d4d7de',
    background: '#ffffff',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.16)',
    zIndex: 200,
  },
  referenceMenuPanel: {
    position: 'fixed',
    width: '280px',
    display: 'grid',
    gap: '10px',
    padding: '12px',
    borderRadius: '12px',
    border: '1px solid #d4d7de',
    background: '#ffffff',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.16)',
    zIndex: 200,
  },
  fontMenuLabel: {
    color: '#4b5563',
    fontSize: '12px',
    fontWeight: '700',
  },
  referenceMenuLabel: {
    color: '#4b5563',
    fontSize: '12px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  fontPicker: {
    display: 'grid',
    gap: '6px',
  },
  fontPickerTrigger: {
    width: '100%',
    height: '34px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid #cfd4dd',
    background: '#fbfbfc',
    color: '#2b2f37',
    fontSize: '13px',
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    userSelect: 'none',
  },
  fontPickerTriggerDisabled: {
    cursor: 'not-allowed',
    opacity: 0.7,
  },
  fontPickerValue: {
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    paddingRight: '8px',
  },
  fontPickerChevron: {
    color: '#6b7280',
    fontSize: '11px',
    flexShrink: 0,
  },
  fontOptionList: {
    maxHeight: '180px',
    overflowY: 'auto',
    display: 'grid',
    gap: '4px',
    padding: '6px',
    borderRadius: '10px',
    border: '1px solid #d8dde6',
    background: '#f8fafc',
  },
  fontOptionItem: {
    minHeight: '34px',
    padding: '7px 10px',
    borderRadius: '8px',
    color: '#1f2937',
    fontSize: '14px',
    lineHeight: '1.4',
    cursor: 'pointer',
    outline: 'none',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
  },
  fontOptionItemActive: {
    background: '#ffffff',
    boxShadow: 'inset 0 0 0 1px #cbd5e1',
  },
  referenceOptionList: {
    maxHeight: '220px',
    overflowY: 'auto',
    display: 'grid',
    gap: '4px',
    padding: '6px',
    borderRadius: '10px',
    border: '1px solid #d8dde6',
    background: '#f8fafc',
  },
  referenceOptionItem: {
    minHeight: '40px',
    padding: '8px 10px',
    borderRadius: '8px',
    color: '#1f2937',
    cursor: 'pointer',
    outline: 'none',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    background: '#ffffff',
    boxShadow: 'inset 0 0 0 1px #e2e8f0',
  },
  referenceOptionItemPrimary: {
    background: '#eff6ff',
    boxShadow: 'inset 0 0 0 1px #bfdbfe',
  },
  referenceOptionTextGroup: {
    minWidth: 0,
    display: 'grid',
    gap: '2px',
  },
  referenceOptionTitle: {
    fontSize: '13px',
    fontWeight: '700',
    lineHeight: '1.3',
  },
  referenceOptionMeta: {
    color: '#64748b',
    fontSize: '11px',
    lineHeight: '1.4',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fontMenuNotice: {
    padding: '8px 10px',
    borderRadius: '8px',
    background: '#f4f4f5',
    color: '#52525b',
    fontSize: '12px',
    lineHeight: '1.5',
  },
  previewChip: {
    minWidth: '30px',
    height: '30px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid #cbced6',
    background: '#ffffff',
    color: '#404552',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    outline: 'none',
  },
  previewChipLabel: {
    minWidth: '52px',
    height: '30px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid #cbced6',
    background: '#ffffff',
    color: '#404552',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'default',
  },
  panelMeta: {
    flex: 1,
    minWidth: 0,
    fontSize: '12px',
    fontWeight: '700',
    color: '#646b78',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'right',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  editorSurface: {
    flex: 1,
    minHeight: 0,
    background: '#fbfbfc',
  },
  codeFrame: {
    height: '100%',
    display: 'grid',
    gridTemplateColumns: '52px 1fr',
    background: '#fbfbfc',
  },
  lineGutter: {
    overflow: 'hidden',
    background: '#f1f2f5',
    borderRight: '1px solid #e2e4ea',
    padding: '14px 0',
    textAlign: 'right',
  },
  lineNumber: {
    height: '24px',
    padding: '0 12px 0 0',
    color: '#b1b6c2',
    fontSize: '13px',
    lineHeight: '24px',
    fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
  },
  textarea: {
    width: '100%',
    height: '100%',
    border: 'none',
    resize: 'none',
    outline: 'none',
    background: '#fbfbfc',
    color: '#2b2f37',
    padding: '14px 18px',
    fontSize: '15px',
    lineHeight: '24px',
    fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
    tabSize: 2,
  },
  centerPlaceholder: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '36px',
    color: '#6b7280',
    fontSize: '14px',
    lineHeight: '1.8',
  },
  placeholderStrong: {
    color: '#2c3b4c',
  },
  previewFrame: {
    display: 'flex',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    background: '#d7d7dc',
    overflow: 'hidden',
  },
  previewPlaceholder: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666a73',
    fontSize: '14px',
    letterSpacing: '0.02em',
  },
  floatingPreviewWindow: {
    position: 'fixed',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    width: 'min(560px, calc(100vw - 96px))',
    height: 'calc(100vh - 128px)',
    minHeight: '420px',
    borderRadius: '16px',
    overflow: 'hidden',
    border: '1px solid #cfd4dd',
    background: '#f7f7f9',
    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.24)',
    zIndex: 40,
  },
  floatingPreviewHeader: {
    flexShrink: 0,
    cursor: 'move',
    userSelect: 'none',
  },
  floatingPreviewMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    fontWeight: '700',
    color: '#646b78',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  floatingDragHandle: {
    color: '#94a3b8',
    fontSize: '14px',
    letterSpacing: '-0.1em',
  },
}
