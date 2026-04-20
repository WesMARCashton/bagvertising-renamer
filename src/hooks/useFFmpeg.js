import { useState, useRef, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

export function useFFmpeg() {
  const ffmpegRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (ready || loading) return
    setLoading(true)
    try {
      const ffmpeg = new FFmpeg()
      ffmpegRef.current = ffmpeg

      await ffmpeg.load({
        coreURL: await toBlobURL('/ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL('/ffmpeg-core.wasm', 'application/wasm'),
      })
      setReady(true)
    } catch (e) {
      console.error('FFmpeg load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [ready, loading])

  const convertToJpeg = useCallback(async (file) => {
    if (!ffmpegRef.current || !ready) throw new Error('FFmpeg not ready')
    const ffmpeg = ffmpegRef.current
    const inputName = 'input.' + file.name.split('.').pop()
    const outputName = 'output.jpg'

    await ffmpeg.writeFile(inputName, await fetchFile(file))
    await ffmpeg.exec(['-i', inputName, '-q:v', '2', outputName])
    const data = await ffmpeg.readFile(outputName)

    // Clean up
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})

    const blob = new Blob([data.buffer], { type: 'image/jpeg' })
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
  }, [ready])

  return { ready, loading, load, convertToJpeg }
}
