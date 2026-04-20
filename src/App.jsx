import { useState, useCallback, useRef, useEffect } from 'react'
import { useFFmpeg } from './hooks/useFFmpeg'
import styles from './App.module.css'

const VIEWS = ['Bottom', 'Vendor', 'Side A', 'Face', 'Side B', 'Angle 1', 'Angle 2']
const GROUP_SIZE = 7
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff']
const RAW_EXTS = ['cr3', 'cr2', 'nef', 'arw', 'raf', 'dng', 'orf', 'rw2']

function isRaw(file) {
  return RAW_EXTS.includes(file.name.split('.').pop().toLowerCase())
}

function isSupported(file) {
  return SUPPORTED_TYPES.includes(file.type) || file.type === ''
}

export default function App() {
  const [groups, setGroups] = useState([])
  const [processing, setProcessing] = useState(false)
  const [converting, setConverting] = useState(false)
  const [progress, setProgress] = useState(0)
  const dragSrc = useRef(null)
  const { ready: ffmpegReady, loading: ffmpegLoading, load: loadFFmpeg, convertToJpeg } = useFFmpeg()

  // ---- File handling ----
  const handleFiles = useCallback(async (rawFiles) => {
    const files = Array.from(rawFiles).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    )

    const rawFiles2 = files.filter(f => isRaw(f))
    let processable = files.filter(f => !isRaw(f) && isSupported(f))
    const unsupported = files.filter(f => !isRaw(f) && !isSupported(f))

    if (unsupported.length) {
      alert(`${unsupported.length} file(s) skipped — unsupported format.\n${unsupported.map(f => f.name).join(', ')}`)
    }

    // Convert RAW files
    if (rawFiles2.length > 0) {
      setConverting(true)
      if (!ffmpegReady) await loadFFmpeg()
      const converted = []
      for (const f of rawFiles2) {
        try {
          const jpg = await convertToJpeg(f)
          converted.push(jpg)
        } catch (e) {
          console.error('Convert failed for', f.name, e)
        }
      }
      processable = [...processable, ...converted].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      )
      setConverting(false)
    }

    if (!processable.length) return

    const newGroups = []
    for (let i = 0; i < processable.length; i += GROUP_SIZE) {
      const chunk = processable.slice(i, i + GROUP_SIZE)
      newGroups.push({
        id: Date.now() + i,
        files: chunk,
        thumbs: chunk.map(f => URL.createObjectURL(f)),
        status: 'waiting',
        code: null,
        renamedNames: new Array(chunk.length).fill(null),
        error: null,
      })
    }

    setGroups(prev => [...prev, ...newGroups])
  }, [ffmpegReady, loadFFmpeg, convertToJpeg])

  // ---- Drag/drop upload zone ----
  const onDrop = useCallback((e) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  // ---- Process all ----
  const processAll = useCallback(async () => {
    if (processing) return
    setProcessing(true)
    setProgress(0)

    const toProcess = groups.filter(g => g.status !== 'done')
    let done = 0

    for (const g of toProcess) {
      setGroups(prev => prev.map(x => x.id === g.id ? { ...x, status: 'processing' } : x))

      try {
        const result = await readBagCode(g.files[0])
        if (result.code) {
          const ext = g.files[0].name.split('.').pop().toLowerCase()
          const renamedNames = g.files.map((_, si) =>
            si === 0 ? `${result.code}.${ext}` : `${result.code} - ${VIEWS[si]}.${ext}`
          )
          setGroups(prev => prev.map(x => x.id === g.id
            ? { ...x, status: 'done', code: result.code, renamedNames }
            : x
          ))
        } else {
          setGroups(prev => prev.map(x => x.id === g.id
            ? { ...x, status: 'review', error: result.reason || 'Could not read bag code' }
            : x
          ))
        }
      } catch (err) {
        setGroups(prev => prev.map(x => x.id === g.id
          ? { ...x, status: 'error', error: err.message }
          : x
        ))
      }

      done++
      setProgress(Math.round(done / toProcess.length * 100))
      if (done < toProcess.length) await delay(4000)
    }

    setProcessing(false)
  }, [groups, processing])

  // ---- Apply manual code ----
  const applyManual = useCallback((groupId, code) => {
    if (!code.trim()) return
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g
      const ext = g.files[0]?.name.split('.').pop().toLowerCase() || 'jpg'
      const renamedNames = g.files.map((_, si) =>
        si === 0 ? `${code}.${ext}` : `${code} - ${VIEWS[si]}.${ext}`
      )
      return { ...g, code, renamedNames, status: 'done', error: null }
    }))
  }, [])

  // ---- Slot swap ----
  const onSlotDragStart = useCallback((groupId, slotIdx) => {
    dragSrc.current = { groupId, slotIdx }
  }, [])

  const onSlotDrop = useCallback((dstGroupId, dstSlotIdx) => {
    if (!dragSrc.current) return
    const { groupId: srcGroupId, slotIdx: srcSlotIdx } = dragSrc.current
    dragSrc.current = null

    if (srcGroupId === dstGroupId && srcSlotIdx === dstSlotIdx) return

    setGroups(prev => {
      const next = prev.map(g => ({ ...g, files: [...g.files], thumbs: [...g.thumbs], renamedNames: [...g.renamedNames] }))
      const srcGroup = next.find(g => g.id === srcGroupId)
      const dstGroup = next.find(g => g.id === dstGroupId)
      if (!srcGroup || !dstGroup) return prev

      const tmpFile = srcGroup.files[srcSlotIdx]
      const tmpThumb = srcGroup.thumbs[srcSlotIdx]
      srcGroup.files[srcSlotIdx] = dstGroup.files[dstSlotIdx]
      srcGroup.thumbs[srcSlotIdx] = dstGroup.thumbs[dstSlotIdx]
      dstGroup.files[dstSlotIdx] = tmpFile
      dstGroup.thumbs[dstSlotIdx] = tmpThumb

      // Re-apply names
      const reapply = (g) => {
        if (!g.code) return
        const ext = g.files[0]?.name.split('.').pop().toLowerCase() || 'jpg'
        g.renamedNames = g.files.map((_, si) =>
          si === 0 ? `${g.code}.${ext}` : `${g.code} - ${VIEWS[si]}.${ext}`
        )
      }
      reapply(srcGroup)
      if (dstGroupId !== srcGroupId) reapply(dstGroup)

      return next
    })
  }, [])

  // ---- Download ----
  const downloadGroup = useCallback((g) => {
    g.files.forEach((f, si) => {
      setTimeout(() => {
        const a = document.createElement('a')
        a.href = g.thumbs[si]
        a.download = g.renamedNames[si]
        a.click()
      }, si * 300)
    })
  }, [])

  const downloadAll = useCallback(() => {
    let offset = 0
    groups.filter(g => g.status === 'done').forEach(g => {
      g.files.forEach((f, si) => {
        setTimeout(() => {
          const a = document.createElement('a')
          a.href = g.thumbs[si]
          a.download = g.renamedNames[si]
          a.click()
        }, offset * 350)
        offset++
      })
    })
  }, [groups])

  const clearAll = useCallback(() => {
    groups.forEach(g => g.thumbs.forEach(u => URL.revokeObjectURL(u)))
    setGroups([])
    setProgress(0)
  }, [groups])

  const doneCount = groups.filter(g => g.status === 'done').length
  const reviewCount = groups.filter(g => g.status === 'review').length
  const errorCount = groups.filter(g => g.status === 'error').length

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}>🛍</div>
          <div className={styles.brandText}>
            <h1>BagVertising Renamer</h1>
            <p>MARC Group · AI photo naming tool</p>
          </div>
        </div>
        <div className={styles.howItWorks}>
          {[
            { n: 1, title: 'Upload photos', desc: 'Drop all bag photos in order. Every 7 = one bag. CR3/RAW auto-converted.' },
            { n: 2, title: 'AI reads code', desc: 'First photo per bag = bottom. AI extracts the BAG code automatically.' },
            { n: 3, title: 'Download renamed', desc: 'All 7 photos renamed and ready to use.' },
          ].map((s, i, arr) => (
            <div key={s.n} className={styles.stepWrap}>
              <div className={styles.step}>
                <div className={styles.stepNum}>{s.n}</div>
                <div className={styles.stepText}>
                  <strong>{s.title}</strong>
                  <span>{s.desc}</span>
                </div>
              </div>
              {i < arr.length - 1 && <div className={styles.stepArrow}>→</div>}
            </div>
          ))}
        </div>
      </header>

      <main className={styles.main}>
        {/* Drop zone */}
        <label
          className={styles.dropZone}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add(styles.over) }}
          onDragLeave={e => e.currentTarget.classList.remove(styles.over)}
          onDrop={e => { e.currentTarget.classList.remove(styles.over); onDrop(e) }}
        >
          <input type="file" accept="image/*,.cr3,.cr2,.nef,.arw,.raf,.dng" multiple hidden
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
          <div className={styles.dropIcon}>📦</div>
          <div className={styles.dropTitle}>Drop bag photos here</div>
          <div className={styles.dropHint}>
            Upload in order · <em>7 photos per bag</em> · JPG, PNG, or RAW (CR3, NEF, ARW)
          </div>
          {converting && (
            <div className={styles.convertingBadge}>⚙ Converting RAW files...</div>
          )}
          {ffmpegLoading && (
            <div className={styles.convertingBadge}>⬇ Loading RAW converter (~30MB)...</div>
          )}
        </label>

        {/* Controls */}
        {groups.length > 0 && (
          <>
            <div className={styles.controls}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={processAll} disabled={processing}>
                {processing ? 'Processing...' : 'Process All Bags'}
              </button>
              <button className={`${styles.btn} ${styles.btnDl}`} onClick={downloadAll} disabled={doneCount === 0}>
                ↓ Download All Renamed
              </button>
              <button className={`${styles.btn} ${styles.btnGhost}`} onClick={clearAll}>Clear</button>
              <span className={styles.count}>
                {groups.length} bag{groups.length !== 1 ? 's' : ''} · {groups.length * GROUP_SIZE} photos expected
              </span>
            </div>

            {processing && (
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
            )}

            {/* Stats */}
            <div className={styles.stats}>
              <div className={styles.stat}><span className={`${styles.statN}`}>{groups.length}</span><span className={styles.statL}>Bags</span></div>
              <div className={styles.stat}><span className={`${styles.statN} ${styles.green}`}>{doneCount}</span><span className={styles.statL}>Complete</span></div>
              <div className={styles.stat}><span className={`${styles.statN} ${styles.orange}`}>{reviewCount}</span><span className={styles.statL}>Needs Review</span></div>
              <div className={styles.stat}><span className={`${styles.statN} ${styles.red}`}>{errorCount}</span><span className={styles.statL}>Failed</span></div>
            </div>

            {/* Groups */}
            <div className={styles.groups}>
              {groups.map((g, gi) => (
                <BagGroup
                  key={g.id}
                  group={g}
                  groupIndex={gi}
                  onApplyManual={(code) => applyManual(g.id, code)}
                  onDownload={() => downloadGroup(g)}
                  onSlotDragStart={(si) => onSlotDragStart(g.id, si)}
                  onSlotDrop={(si) => onSlotDrop(g.id, si)}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ---- BagGroup component ----
function BagGroup({ group: g, groupIndex, onApplyManual, onDownload, onSlotDragStart, onSlotDrop }) {
  const [manualCode, setManualCode] = useState(g.code || '')
  const [dragOverSlot, setDragOverSlot] = useState(null)

  const statusClass = {
    waiting: '', processing: styles.gProcessing, done: styles.gDone,
    error: styles.gError, review: styles.gIncomplete
  }[g.status] || ''

  return (
    <div className={`${styles.group} ${statusClass}`}>
      {/* Group header */}
      <div className={styles.groupHeader}>
        <span className={styles.groupLabel}>Bag {groupIndex + 1}</span>
        {g.code
          ? <span className={styles.groupCode}>{g.code}</span>
          : <span className={`${styles.groupCode} ${styles.codePending}`}>
              {g.status === 'processing' ? 'reading...' : 'code pending'}
            </span>
        }
        <StatusPill status={g.status} />
      </div>

      {/* File slots */}
      <div className={styles.slots}>
        {Array.from({ length: GROUP_SIZE }).map((_, si) => {
          const thumb = g.thumbs[si]
          const renamed = g.renamedNames[si]
          const label = VIEWS[si]
          const isBottom = si === 0

          return (
            <div
              key={si}
              className={`${styles.slot} ${dragOverSlot === si ? styles.slotOver : ''}`}
              draggable={!!thumb}
              onDragStart={() => { onSlotDragStart(si) }}
              onDragOver={e => { e.preventDefault(); setDragOverSlot(si) }}
              onDragLeave={() => setDragOverSlot(null)}
              onDrop={() => { setDragOverSlot(null); onSlotDrop(si) }}
            >
              {thumb
                ? <img className={styles.slotThumb} src={thumb} alt={label} />
                : <div className={`${styles.slotThumb} ${styles.slotMissing}`}>✕</div>
              }
              <div className={`${styles.slotTag} ${isBottom ? styles.slotBottom : ''} ${renamed ? styles.slotRenamed : ''}`}>
                {renamed ? renamed : (isBottom ? '📍 Bottom' : label)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className={styles.groupActions}>
        {g.status === 'done' && (
          <button className={styles.dlGroupBtn} onClick={onDownload}>↓ Download This Bag</button>
        )}
        <div className={styles.manualRow}>
          <span className={styles.manualLabel}>Code:</span>
          <input
            className={styles.codeInput}
            placeholder="BAG-YFM-WCFM-FC-CA-US-2"
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onApplyManual(manualCode)}
          />
          <button className={styles.applyBtn} onClick={() => onApplyManual(manualCode)}>Apply</button>
        </div>
        {g.files.length < GROUP_SIZE && (
          <span className={styles.incompleteWarn}>⚠ Only {g.files.length} of 7 photos</span>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  const map = {
    waiting: [styles.pillWait, 'waiting'],
    processing: [styles.pillProc, 'reading...'],
    done: [styles.pillDone, 'complete'],
    error: [styles.pillErr, 'failed'],
    review: [styles.pillReview, 'needs review'],
  }
  const [cls, label] = map[status] || map.waiting
  return <span className={`${styles.pill} ${cls}`}>{label}</span>
}

// ---- Helpers ----
async function readBagCode(file) {
  const base64 = await fileToBase64(file)
  const res = await fetch('/api/read-bag-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, mimeType: file.type || 'image/jpeg' })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `API error ${res.status}`)
  }
  return res.json()
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = () => rej(new Error('Failed to read file'))
    r.readAsDataURL(file)
  })
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

