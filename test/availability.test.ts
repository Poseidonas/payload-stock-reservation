import { describe, expect, it } from 'vitest'

import { availableFrom, heldQuantity, holdFits, isActive } from '../src/availability.js'
import type { StockHold } from '../src/types.js'

const make = (id: string, quantity: number, createdAt: string, expiresAt = '2100-01-01T00:00:00.000Z'): StockHold => ({
  cart: `cart-${id}`,
  createdAt,
  expiresAt,
  id,
  quantity,
  stockCollection: 'variants',
  stockDocument: 'v1',
})

describe('heldQuantity', () => {
  it('sums the quantities of every hold', () => {
    expect(heldQuantity([make('a', 2, '2026-01-01T00:00:00.000Z'), make('b', 3, '2026-01-01T00:00:01.000Z')])).toBe(5)
  })

  it('is zero for no holds', () => {
    expect(heldQuantity([])).toBe(0)
  })

  it('ignores a negative quantity rather than crediting stock back', () => {
    expect(heldQuantity([make('a', -4, '2026-01-01T00:00:00.000Z')])).toBe(0)
  })
})

describe('availableFrom', () => {
  it('subtracts the holds from the recorded stock', () => {
    expect(availableFrom(10, [make('a', 3, '2026-01-01T00:00:00.000Z')])).toBe(7)
  })

  it('returns the recorded stock when nothing is held', () => {
    expect(availableFrom(10, [])).toBe(10)
  })

  it('can go below zero when more is held than recorded', () => {
    expect(availableFrom(1, [make('a', 3, '2026-01-01T00:00:00.000Z')])).toBe(-2)
  })
})

describe('holdFits', () => {
  it('accepts a hold that sits inside the recorded stock', () => {
    const holds = [make('a', 2, '2026-01-01T00:00:00.000Z')]

    expect(holdFits({ holdID: 'a', holds, inventory: 5 })).toBe(true)
  })

  it('accepts a hold that lands exactly on the recorded stock', () => {
    const holds = [make('a', 5, '2026-01-01T00:00:00.000Z')]

    expect(holdFits({ holdID: 'a', holds, inventory: 5 })).toBe(true)
  })

  it('refuses a hold larger than the recorded stock', () => {
    const holds = [make('a', 6, '2026-01-01T00:00:00.000Z')]

    expect(holdFits({ holdID: 'a', holds, inventory: 5 })).toBe(false)
  })

  it('gives the last unit to the older of two racing holds', () => {
    const holds = [
      make('older', 1, '2026-01-01T00:00:00.000Z'),
      make('newer', 1, '2026-01-01T00:00:00.500Z'),
    ]

    expect(holdFits({ holdID: 'older', holds, inventory: 1 })).toBe(true)
    expect(holdFits({ holdID: 'newer', holds, inventory: 1 })).toBe(false)
  })

  it('breaks a tie on the identifier so that exactly one hold wins', () => {
    const holds = [
      make('aaa', 1, '2026-01-01T00:00:00.000Z'),
      make('bbb', 1, '2026-01-01T00:00:00.000Z'),
    ]

    expect(holdFits({ holdID: 'aaa', holds, inventory: 1 })).toBe(true)
    expect(holdFits({ holdID: 'bbb', holds, inventory: 1 })).toBe(false)
  })

  it('is not affected by the order the holds arrive in', () => {
    const holds = [
      make('newer', 1, '2026-01-01T00:00:00.500Z'),
      make('older', 1, '2026-01-01T00:00:00.000Z'),
    ]

    expect(holdFits({ holdID: 'older', holds, inventory: 1 })).toBe(true)
  })

  it('refuses a hold that is not in the list at all', () => {
    const holds = [make('a', 1, '2026-01-01T00:00:00.000Z')]

    expect(holdFits({ holdID: 'missing', holds, inventory: 100 })).toBe(false)
  })

  it('refuses every hold when the recorded stock is zero', () => {
    const holds = [make('a', 1, '2026-01-01T00:00:00.000Z')]

    expect(holdFits({ holdID: 'a', holds, inventory: 0 })).toBe(false)
  })

  it('counts the earlier holds of the same cart towards the total', () => {
    const holds = [
      make('first', 2, '2026-01-01T00:00:00.000Z'),
      make('second', 2, '2026-01-01T00:00:01.000Z'),
    ]

    expect(holdFits({ holdID: 'second', holds, inventory: 3 })).toBe(false)
    expect(holdFits({ holdID: 'second', holds, inventory: 4 })).toBe(true)
  })

  it('treats an unreadable creation time as the oldest possible', () => {
    const holds = [make('broken', 1, 'not a date'), make('good', 1, '2026-01-01T00:00:00.000Z')]

    expect(holdFits({ holdID: 'broken', holds, inventory: 1 })).toBe(true)
    expect(holdFits({ holdID: 'good', holds, inventory: 1 })).toBe(false)
  })
})

describe('isActive', () => {
  it('is true while the hold has time left', () => {
    expect(isActive(make('a', 1, '2026-01-01T00:00:00.000Z'), Date.parse('2026-01-01T00:00:00.000Z'))).toBe(true)
  })

  it('is false once the hold has expired', () => {
    const expired = make('a', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:10:00.000Z')

    expect(isActive(expired, Date.parse('2026-01-01T00:20:00.000Z'))).toBe(false)
  })
})
