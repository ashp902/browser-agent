import { useSyncExternalStore } from 'react';
import { getState, subscribe } from './store';

export function useShopState() {
  return useSyncExternalStore(subscribe, getState);
}
