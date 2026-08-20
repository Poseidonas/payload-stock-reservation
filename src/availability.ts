import type { StockHold } from './types.js'

const time = (value: string): number => {
  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? 0 : parsed
}

const compare = (a: StockHold, b: StockHold): number => {
  const left = time(a.createdAt)
  const right = time(b.createdAt)

  if (left !== right) {
    return left - right
  }

  if (a.id === b.id) {
    return 0
  }

  return a.id < b.id ? -1 : 1
}

export const heldQuantity = (holds: StockHold[]): number =>
  holds.reduce((total, hold) => total + (hold.quantity > 0 ? hold.quantity : 0), 0)

export const availableFrom = (inventory: number, holds: StockHold[]): number =>
  inventory - heldQuantity(holds)

/**
 * Decides whether a hold that has already been written fits inside the
 * recorded stock. Holds are ranked oldest first, so that of two checkouts
 * racing for the last unit exactly one keeps it.
 */
export const holdFits = (args: {
  holdID: string
  holds: StockHold[]
  inventory: number
}): boolean => {
  const { holdID, holds, inventory } = args
  const ordered = [...holds].sort(compare)

  let running = 0

  for (const hold of ordered) {
    running += hold.quantity > 0 ? hold.quantity : 0

    if (hold.id === holdID) {
      return running <= inventory
    }
  }

  return false
}

export const isActive = (hold: StockHold, now: number): boolean => time(hold.expiresAt) > now
