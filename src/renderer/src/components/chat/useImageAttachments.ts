// Image-attachment state for the composer: drag-and-drop / file-picker / paste of
// image files into the next message. Extracted from Composer.tsx (behavior-
// preserving) so the component file stays focused.
import { useRef, useState, type DragEvent as RDragEvent } from 'react'

export interface Attachment {
  id: string
  mediaType: string
  base64: string
  preview: string
  name: string
}

export interface ImageAttachments {
  attachments: Attachment[]
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  dragOver: boolean
  setDragOver: React.Dispatch<React.SetStateAction<boolean>>
  fileRef: React.RefObject<HTMLInputElement | null>
  /** Read image files into base64 attachments. */
  addFiles: (files: FileList | null) => void
  /** Drop handler for the composer drop-zone. */
  onDrop: (e: RDragEvent) => void
}

export function useImageAttachments(): ImageAttachments {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function addFiles(files: FileList | null): void {
    if (!files) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result)
        const base64 = dataUrl.split(',')[1] ?? ''
        setAttachments((prev) => [
          ...prev,
          { id: crypto.randomUUID(), mediaType: file.type, base64, preview: dataUrl, name: file.name }
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  function onDrop(e: RDragEvent): void {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
  }

  return { attachments, setAttachments, dragOver, setDragOver, fileRef, addFiles, onDrop }
}
