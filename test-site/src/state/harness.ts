// Test-only harness (docs/11 §16). Exposed for automated tests and manual
// verification; not linked in the UI and not available to agent tools.

import * as store from './store';

declare global {
  interface Window {
    __SHOP_HARNESS__: {
      reset(): void;
      getCart(): unknown;
      getOrders(): unknown;
      getReturns(): unknown;
      isLoggedIn(): boolean;
      markLoggedIn(): void;
      simulateInventoryRefresh(): void;
      getPlacedOrderIds(): string[];
      accountSaved(): boolean;
    };
  }
}

export function installHarness(): void {
  window.__SHOP_HARNESS__ = {
    reset: store.resetAll,
    getCart: () => store.getState().cart,
    getOrders: () => store.getState().orders,
    getReturns: () => store.getState().returns,
    isLoggedIn: () => store.getState().loggedIn,
    markLoggedIn: store.markLoggedIn,
    simulateInventoryRefresh: store.simulateInventoryRefresh,
    getPlacedOrderIds: () => store.getState().placedOrderIds,
    accountSaved: () => store.getState().accountSaved,
  };
}
