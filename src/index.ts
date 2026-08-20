import type { Config } from 'payload'

import { resolveConfig } from './config.js'
import {
  isConfirmPath,
  isInitiatePath,
  releaseEndpoint,
  wrapConfirm,
  wrapInitiate,
} from './endpoints.js'
import { holdsCollection } from './holds.js'
import type { ResolvedConfig, StockReservationConfig } from './types.js'

export { availableStock } from './stock.js'
export { refusalCodes } from './errors.js'
export { releaseExpiredHolds } from './holds.js'
export type { RefusalCode, StockReservationConfig } from './types.js'

const reportProblems =
  (existing: Config['onInit'], problems: string[]): NonNullable<Config['onInit']> =>
  async (payload) => {
    if (existing) {
      await existing(payload)
    }

    for (const problem of problems) {
      payload.logger.error(`payload-stock-reservation: ${problem}`)
    }
  }

const shadowedByCollection = (config: ResolvedConfig, slugs: string[]): boolean => {
  const first = config.releaseEndpointPath.split('/')[1]

  return typeof first === 'string' && first !== '' && slugs.includes(first)
}

export const stockReservationPlugin =
  (incoming: StockReservationConfig = {}) =>
  (incomingConfig: Config): Config => {
    const config = resolveConfig(incoming)
    const collections = incomingConfig.collections ?? []
    const endpoints = incomingConfig.endpoints ?? []

    let wrapped = 0

    const nextEndpoints = endpoints.map((endpoint) => {
      if (endpoint.method !== 'post' || typeof endpoint.path !== 'string') {
        return endpoint
      }

      if (isInitiatePath(endpoint.path)) {
        wrapped += 1

        return { ...endpoint, handler: wrapInitiate(config, endpoint.handler) }
      }

      if (isConfirmPath(endpoint.path)) {
        wrapped += 1

        return { ...endpoint, handler: wrapConfirm(config, endpoint.handler) }
      }

      return endpoint
    })

    const hasHolds = collections.some((collection) => collection.slug === config.holdsSlug)
    const nextCollections = hasHolds ? collections : [...collections, holdsCollection(config)]

    const problems: string[] = []

    if (wrapped === 0) {
      problems.push(
        'no checkout endpoints were found to wrap, so stock is neither validated nor held. List this plugin after ecommercePlugin in the plugins array.',
      )
    }

    if (shadowedByCollection(config, nextCollections.map((collection) => collection.slug))) {
      problems.push(
        `the release endpoint path ${config.releaseEndpointPath} starts with a collection slug, so Payload routes it to that collection and never reaches the endpoint. Give releaseEndpointPath a first segment that is not a collection slug.`,
      )
    }

    const next: Config = {
      ...incomingConfig,
      collections: nextCollections,
      endpoints: [...nextEndpoints, releaseEndpoint(config)],
    }

    return problems.length === 0
      ? next
      : { ...next, onInit: reportProblems(incomingConfig.onInit, problems) }
  }
