import type { PayloadRequest } from 'payload'

export type CartReference = {
  id: number | string
  key: string
}

/**
 * Reads the JSON body once and leaves `json` and `text` in place so that the
 * handler being wrapped can read it again.
 */
export const readBody = async (
  req: PayloadRequest,
): Promise<undefined | Record<string, unknown>> => {
  if (req.data && typeof req.data === 'object') {
    return req.data as Record<string, unknown>
  }

  const header = req.headers?.get('content-type') ?? ''
  const contentType = header.split(';', 1)[0]?.trim()

  if (contentType !== 'application/json' || typeof req.text !== 'function') {
    return undefined
  }

  const text = await req.text()

  if (!text) {
    return undefined
  }

  const data = JSON.parse(text) as Record<string, unknown>

  const body = req as unknown as {
    json?: () => Promise<unknown>
    text?: () => Promise<string>
  }

  req.data = data
  body.json = () => Promise.resolve(data)
  body.text = () => Promise.resolve(text)

  return data
}

const reference = (value: unknown): null | CartReference => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { id: value, key: String(value) }
  }

  if (typeof value === 'string' && value !== '') {
    return { id: value, key: value }
  }

  if (typeof value === 'object' && value !== null) {
    return reference((value as { id?: unknown }).id)
  }

  return null
}

export const resolveCart = (
  req: PayloadRequest,
  data: undefined | Record<string, unknown>,
): null | CartReference => {
  const fromBody = reference(data?.cartID)

  if (fromBody) {
    return fromBody
  }

  const user = req.user as null | { cart?: { docs?: unknown[] } }
  const docs = user?.cart?.docs

  return Array.isArray(docs) && docs.length > 0 ? reference(docs[0]) : null
}
