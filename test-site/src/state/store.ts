// In-memory deterministic shop state (docs/11 §2, §16, §17).
//
// Plain external store consumed through useSyncExternalStore. The test harness
// (window.__SHOP_HARNESS__) operates on this module directly; it is never
// linked in the normal UI and is not reachable through agent tools.

import { SEED_ORDERS, type Order } from '../data/orders';
import type { Product } from '../data/products';

export interface CartItem {
  productId: string;
  productName: string;
  size: string;
  quantity: number;
  price_cents: number;
}

export interface ReturnRecord {
  orderId: string;
  reason: string;
}

export interface ShopState {
  cart: CartItem[];
  orders: Order[];
  returns: ReturnRecord[];
  loggedIn: boolean;
  /** Orders actually placed through "Place order" during this session. */
  placedOrderIds: string[];
  /** Bumped by the harness to force product-card remounts (stale element IDs). */
  inventoryRefreshCounter: number;
  accountSaved: boolean;
}

function initialState(): ShopState {
  return {
    cart: [],
    orders: SEED_ORDERS.map((order) => ({ ...order })),
    returns: [],
    loggedIn: false,
    placedOrderIds: [],
    inventoryRefreshCounter: 0,
    accountSaved: false,
  };
}

let state: ShopState = initialState();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): ShopState {
  return state;
}

function setState(patch: Partial<ShopState>): void {
  state = { ...state, ...patch };
  notify();
}

export function addToCart(product: Product, size: string): void {
  const existing = state.cart.find(
    (item) => item.productId === product.id && item.size === size,
  );
  const cart = existing
    ? state.cart.map((item) =>
        item.productId === product.id && item.size === size
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      )
    : [
        ...state.cart,
        {
          productId: product.id,
          productName: product.name,
          size,
          quantity: 1,
          price_cents: product.price_cents,
        },
      ];
  setState({ cart });
}

export function removeFromCart(index: number): void {
  setState({ cart: state.cart.filter((_, i) => i !== index) });
}

export function setQuantity(index: number, quantity: number): void {
  setState({
    cart: state.cart.map((item, i) => (i === index ? { ...item, quantity } : item)),
  });
}

/** docs/11 §7: an order exists only if "Place order" actually executes. */
export function placeOrder(): string | null {
  if (state.cart.length === 0) return null;
  const total = state.cart.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
  const nextNumber = 1005 + state.placedOrderIds.length;
  const order: Order = {
    id: `o-${nextNumber}`,
    date: '2026-08-24',
    status: 'Processing',
    total_cents: total,
    items: state.cart.map((item) => ({ ...item })),
  };
  setState({
    orders: [...state.orders, order],
    placedOrderIds: [...state.placedOrderIds, order.id],
    cart: [],
  });
  return order.id;
}

export function startReturn(orderId: string, reason: string): boolean {
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) return false;
  setState({ returns: [...state.returns, { orderId, reason }] });
  return true;
}

export function saveAccount(): void {
  setState({ accountSaved: true });
}

export function markLoggedIn(): void {
  setState({ loggedIn: true });
}

/** docs/11 §13: replaces card elements so old executor IDs go stale. */
export function simulateInventoryRefresh(): void {
  setState({ inventoryRefreshCounter: state.inventoryRefreshCounter + 1 });
}

export function resetAll(): void {
  state = initialState();
  notify();
}
