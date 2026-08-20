import { describe, expect, it } from 'vitest'

import { refusal, refusalCodes, refusalResponse } from '../src/errors.js'

describe('refusal', () => {
  it('defaults to status 400', () => {
    expect(
      refusal({
        code: refusalCodes.OutOfStock,
        collection: 'variants',
        document: 'v1',
        message: 'Nothing left.',
      }).status,
    ).toBe(400)
  })

  it('carries a status when one is given', () => {
    expect(
      refusal({
        code: refusalCodes.NotFound,
        collection: 'variants',
        document: 'v1',
        message: 'Gone.',
        status: 404,
      }).status,
    ).toBe(404)
  })

  it('names the four reasons a line can be refused', () => {
    expect(refusalCodes).toEqual({
      MissingPrice: 'MissingPrice',
      NegativeInventory: 'NegativeInventory',
      NotFound: 'NotFound',
      OutOfStock: 'OutOfStock',
    })
  })
})

describe('refusalResponse', () => {
  it('sends the status of the refusal', () => {
    const response = refusalResponse(
      refusal({
        code: refusalCodes.OutOfStock,
        collection: 'variants',
        document: 'v1',
        message: 'Only 2 left.',
      }),
    )

    expect(response.status).toBe(400)
  })

  it('sends a readable message rather than an empty object', async () => {
    const response = refusalResponse(
      refusal({
        code: refusalCodes.OutOfStock,
        collection: 'variants',
        document: 'v1',
        message: 'Only 2 left.',
      }),
    )

    const body = (await response.json()) as { message: unknown }

    expect(typeof body.message).toBe('string')
    expect(body.message).toBe('Only 2 left.')
  })

  it('sends the machine readable reason under cause', async () => {
    const response = refusalResponse(
      refusal({
        code: refusalCodes.MissingPrice,
        collection: 'variants',
        document: 'v9',
        message: 'No price.',
      }),
    )

    const body = (await response.json()) as { cause: Record<string, unknown> }

    expect(body.cause).toEqual({
      code: 'MissingPrice',
      collection: 'variants',
      document: 'v9',
    })
  })
})
