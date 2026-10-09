export const createImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.setAttribute('crossOrigin', 'anonymous')
    image.src = url
  })

export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  options: {
    fileName?: string
    mimeType?: "image/jpeg" | "image/png" | "image/webp"
    quality?: number
    maxWidth?: number
    maxHeight?: number
  } = {}
): Promise<File> {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('No 2d context')
  }

  const scale = Math.min(
    1,
    options.maxWidth ? options.maxWidth / pixelCrop.width : 1,
    options.maxHeight ? options.maxHeight / pixelCrop.height : 1
  )
  canvas.width = Math.max(1, Math.round(pixelCrop.width * scale))
  canvas.height = Math.max(1, Math.round(pixelCrop.height * scale))

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    canvas.width,
    canvas.height
  )

  return new Promise((resolve, reject) => {
    const mimeType = options.mimeType || 'image/jpeg'
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(new File([blob], options.fileName || 'avatar.jpg', { type: mimeType, lastModified: Date.now() }))
      } else {
        reject(new Error('Canvas is empty'))
      }
    }, mimeType, options.quality ?? 0.92)
  })
}
