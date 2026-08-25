import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatPrice } from '../data/products';
import { placeOrder } from '../state/store';
import { useShopState } from '../state/hooks';

export function CheckoutPage() {
  const cart = useShopState().cart;
  const navigate = useNavigate();
  const [shippingName, setShippingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const total = cart.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (shippingName.trim() === '') {
      setError('Shipping name is required.');
      return;
    }
    // docs/11 §7: consequential final action - creates an order only if it
    // actually executes. Policy confirmation gating arrives in Milestone 6.
    const orderId = placeOrder();
    if (orderId === null) {
      setError('Cart is empty.');
      return;
    }
    navigate(`/orders/${orderId}`);
  };

  return (
    <main>
      <h1>Checkout</h1>
      <form aria-label="Shipping address" onSubmit={submit}>
        <fieldset>
          <legend>Shipping address</legend>
          <label htmlFor="ship-name">Full name</label>
          <input id="ship-name" value={shippingName} onChange={(e) => setShippingName(e.target.value)} />
          <br />
          <label htmlFor="ship-address">Street address</label>
          <input id="ship-address" />
          <br />
          <label htmlFor="ship-city">City</label>
          <input id="ship-city" />
          <br />
          <label htmlFor="ship-zip">ZIP code</label>
          <input id="ship-zip" />
        </fieldset>

        <section aria-label="Order summary">
          <h2>Order summary</h2>
          <ul>
            {cart.map((item) => (
              <li key={`${item.productId}-${item.size}`}>
                {item.quantity} × {item.productName} (size {item.size}) —{' '}
                {formatPrice(item.price_cents * item.quantity)}
              </li>
            ))}
          </ul>
          <p>
            Total: <strong>{formatPrice(total)}</strong>
          </p>
        </section>

        {/* docs/11 §7: fake payment fields with realistic types/autocomplete so
            the sensitive-field classifier can identify them. Never validated or
            stored; the test flow does not require them. */}
        <fieldset>
          <legend>Payment (fixture only)</legend>
          <label htmlFor="card-name">Name on card</label>
          <input id="card-name" autoComplete="cc-name" />
          <br />
          <label htmlFor="card-number">Card number</label>
          <input id="card-number" inputMode="numeric" autoComplete="cc-number" />
          <br />
          <label htmlFor="card-exp">Expiry</label>
          <input id="card-exp" placeholder="MM/YY" autoComplete="cc-exp" />
          <br />
          <label htmlFor="card-cvv">Security code</label>
          <input id="card-cvv" inputMode="numeric" autoComplete="cc-csc" maxLength={4} />
        </fieldset>

        {error !== null && (
          <p role="alert" data-testid="checkout-error">
            {error}
          </p>
        )}
        <button type="submit">Place order</button>
      </form>
    </main>
  );
}
