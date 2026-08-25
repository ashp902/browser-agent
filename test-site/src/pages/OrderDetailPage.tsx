import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatPrice } from '../data/products';
import { startReturn } from '../state/store';
import { useShopState } from '../state/hooks';

// docs/11 §10: order detail with Start return opening a labeled dialog; the
// final Submit return is a consequential fixture action.

const RETURN_ELIGIBLE: OrderStatus[] = ['Delivered', 'Shipped'];
type OrderStatus = 'Delivered' | 'Shipped' | 'Processing';

export function OrderDetailPage() {
  const orders = useShopState().orders;
  const returns = useShopState().returns;
  const { orderId } = useParams();
  const order = orders.find((candidate) => candidate.id === orderId);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('wrong-size');
  const [returnError, setReturnError] = useState<string | null>(null);

  if (!order) {
    return (
      <main>
        <h1>Order not found</h1>
        <p>No order with ID "{orderId}".</p>
        <Link to="/orders">Back to orders</Link>
      </main>
    );
  }

  const eligible = RETURN_ELIGIBLE.includes(order.status as OrderStatus);
  const alreadyReturned = returns.some((record) => record.orderId === order.id);

  const submitReturn = (event: React.FormEvent) => {
    event.preventDefault();
    if (startReturn(order.id, reason)) {
      dialogRef.current?.close();
      setReturnError(null);
    } else {
      setReturnError('The return could not be created.');
    }
  };

  return (
    <main>
      <h1>Order {order.id}</h1>
      <p>
        Placed {order.date} — status <strong>{order.status}</strong>
      </p>
      <section aria-label="Items">
        <h2>Items</h2>
        <ul>
          {order.items.map((item) => (
            <li key={`${item.productId}-${item.size}`}>
              {item.quantity} × {item.productName} (size {item.size}) —{' '}
              {formatPrice(item.price_cents * item.quantity)}
            </li>
          ))}
        </ul>
        <p>
          Total: <strong>{formatPrice(order.total_cents)}</strong>
        </p>
      </section>

      <h2>Returns</h2>
      {alreadyReturned ? (
        <p role="status">A return has been started for this order.</p>
      ) : eligible ? (
        <button onClick={() => dialogRef.current?.showModal()}>Start return</button>
      ) : (
        <p>This order is not yet eligible for a return.</p>
      )}
      {returns
        .filter((record) => record.orderId === order.id)
        .map((record) => (
          <p key={record.reason + record.orderId} data-testid="return-record">
            Return reason: {record.reason}
          </p>
        ))}

      {/* Native dialog keeps background controls in the DOM (docs/11 §12). */}
      <dialog ref={dialogRef} aria-label={`Start return for order ${order.id}`}>
        <form method="dialog" onSubmit={submitReturn}>
          <h2>Start return for order {order.id}?</h2>
          <label htmlFor="return-reason">Reason</label>{' '}
          <select id="return-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="wrong-size">Wrong size</option>
            <option value="damaged">Damaged</option>
            <option value="changed-mind">Changed my mind</option>
          </select>
          <div style={{ marginTop: '0.5rem' }}>
            <button type="submit" value="confirm">
              Submit return
            </button>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
      {returnError !== null && (
        <p role="alert" data-testid="return-error">
          {returnError}
        </p>
      )}

      <p>
        <Link to="/orders">Back to orders</Link>
      </p>
    </main>
  );
}
