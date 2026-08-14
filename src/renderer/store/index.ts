import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { createJsonSlice } from './jsonSlice'
import { createUiSlice } from './uiSlice'
import type { StoreState } from './types'

export const useStore = create<StoreState>()(
  subscribeWithSelector((...a) => ({
    ...createJsonSlice(...a),
    ...createUiSlice(...a)
  }))
)

export type { StoreState } from './types'
