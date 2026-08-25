// Deterministic order fixtures (docs/11 §9-§10). Fixed dates and statuses.

export interface OrderItem {
  productId: string;
  productName: string;
  size: string;
  quantity: number;
  price_cents: number;
}

export interface Order {
  id: string;
  date: string; // fixed ISO date string
  status: 'Delivered' | 'Shipped' | 'Processing';
  total_cents: number;
  items: OrderItem[];
}

export const SEED_ORDERS: Order[] = [
  {
    id: 'o-1001',
    date: '2026-05-02',
    status: 'Delivered',
    total_cents: 8900,
    items: [{ productId: 'swift-pace-lite', productName: 'Swift Pace Lite', size: '9', quantity: 1, price_cents: 8900 }],
  },
  {
    id: 'o-1002',
    date: '2026-06-18',
    status: 'Shipped',
    total_cents: 14000,
    items: [{ productId: 'peak-hiker', productName: 'Peak Hiker', size: '10', quantity: 1, price_cents: 14000 }],
  },
  {
    id: 'o-1003',
    date: '2026-07-25',
    status: 'Delivered',
    total_cents: 5500,
    items: [{ productId: 'summer-breeze', productName: 'Summer Breeze', size: '7', quantity: 1, price_cents: 5500 }],
  },
  {
    id: 'o-1004',
    date: '2026-08-10',
    status: 'Processing',
    total_cents: 22000,
    items: [
      { productId: 'marathon-elite', productName: 'Marathon Elite', size: '10', quantity: 1, price_cents: 18000 },
      { productId: 'cloud-walk', productName: 'Cloud Walk', size: '8', quantity: 1, price_cents: 4000 },
    ],
  },
];
