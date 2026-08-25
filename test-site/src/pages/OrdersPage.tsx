import { Link } from 'react-router-dom';
import { formatPrice } from '../data/products';
import { useShopState } from '../state/hooks';

// docs/11 §9: semantic table with repeated View actions per row.

export function OrdersPage() {
  const orders = useShopState().orders;

  return (
    <main>
      <h1>Orders</h1>
      <table>
        <caption>Orders</caption>
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Date</th>
            <th scope="col">Status</th>
            <th scope="col">Total</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>{order.id}</td>
              <td>{order.date}</td>
              <td>{order.status}</td>
              <td>{formatPrice(order.total_cents)}</td>
              <td>
                <Link to={`/orders/${order.id}`}>View {order.id}</Link>
                {' '}
                <Link to={`/orders/${order.id}`}>Details</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
